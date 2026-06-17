// browser.dioxus.execute implementation.
//
// Two entry points for browser-side JS:
//
//   - `execute`: the user-facing API. Accepts a function or a raw string
//     script. Function form serialises to source and wraps so the user's
//     callback receives `dx = window.__WDIO_DIOXUS__` as its first arg.
//     String form is passed through unchanged — users writing strings get
//     the standard WDIO behaviour where the body is wrapped as
//     `function() { ${body} }` and `arguments` is bound to the spread args.
//
//   - `runInterceptorScript`: the internal helper consumed by mock.ts. The
//     DioxusAdapter scripts are arrow-function literals (e.g. `(_dx) => { ... }`)
//     which must be *invoked*, not just defined. This helper wraps them as
//     `return (${script})()` before passing to `browser.execute`, mirroring
//     the Tauri analogue (packages/tauri-service/src/mock.ts).
//
// Multi-window routing + the windowLabel sentinel from Tauri's equivalent
// are deferred to a Phase 4 multi-window commit.

import type { DioxusAPIs } from '@wdio/native-types';

export async function execute<ReturnValue, InnerArguments extends unknown[] = unknown[]>(
  browser: WebdriverIO.Browser,
  script: string | ((dx: DioxusAPIs, ...args: InnerArguments) => ReturnValue),
  ...args: InnerArguments
): Promise<ReturnValue> {
  if (typeof script === 'function') {
    const fnSource = script.toString();
    // Inline the args as JSON literals rather than relying on `arguments`.
    // WDIO's exact wrapping of the string script is not contractually fixed
    // (older versions used `function() { ... }`, but modern wrappers may
    // emit arrow functions — and arrow functions have no own `arguments`
    // binding). Inlining keeps the call-site portable.
    //
    // The wrapper body itself stays synchronous (no top-level `await`), but
    // returns a Promise. Both driver paths await it before delivering the
    // result: the embedded driver via guest-js's AsyncFunction polling loop,
    // and the external driver via the W3C WebDriver executeScript spec which
    // requires drivers to resolve a returned promise before completing.
    const argsLiteral = args
      .map((a, i) => {
        try {
          return JSON.stringify(a) ?? 'undefined';
        } catch (err) {
          throw new Error(
            `[wdio-dioxus-service] browser.dioxus.execute argument at index ${i} is not JSON-serialisable ` +
              `(args are inlined into the script source via JSON.stringify). ` +
              `This typically means the value contains a circular reference, a BigInt, or a function. ` +
              `Underlying error: ${(err as Error).message}`,
          );
        }
      })
      .join(', ');
    // The user's function is wrapped in an explicit Promise so any
    // synchronous throw is converted to a controlled rejection — protects
    // against WKWebView edge cases where an AsyncFunction body throwing
    // through an IIFE can leave the eval pipeline in an inconsistent state.
    // Promise.resolve(...).then(resolve, reject) handles both sync values
    // and returned promises (incl. those that reject after an await).
    const wrapped = `
      const userFn = (${fnSource});
      const dx = window.__WDIO_DIOXUS__;
      if (!dx || typeof dx.invoke !== 'function') {
        throw new Error(
          '[wdio-dioxus-service] window.__WDIO_DIOXUS__.invoke is not installed. ' +
          'Did you forget to call wdio_dioxus_bridge::install(config) in your Dioxus main.rs?'
        );
      }
      return new Promise(function (resolve, reject) {
        try {
          Promise.resolve(userFn(dx, ${argsLiteral})).then(resolve, reject);
        } catch (e) {
          reject(e);
        }
      });
    `;
    const raw = await browser.execute(wrapped);
    return unwrapEmbeddedResult<ReturnValue>(raw);
  }

  const raw = await browser.execute(script, ...args);
  return unwrapEmbeddedResult<ReturnValue>(raw);
}

/**
 * Internal helper for invoking DioxusAdapter scripts. Each adapter-built
 * script is an arrow-function literal — wrapping with `return (${script})()`
 * is what actually invokes it. Without this wrap the function is defined
 * but never called and `window.__wdio_mocks__` is never populated.
 *
 * Not exported from the package's public surface — only consumed by mock.ts.
 */
export async function runInterceptorScript<T>(browser: WebdriverIO.Browser, script: string): Promise<T> {
  const raw = await browser.execute(`return (${script})()`);
  return unwrapEmbeddedResult<T>(raw);
}

// The embedded polling loop wraps every result in { __wdio_value__: result }
// before JSON-serialising it through the IPC channel. JSON.stringify omits
// undefined properties, so { __wdio_value__: undefined } → {} (key absent),
// while { __wdio_value__: null } → {"__wdio_value__":null} (key present).
// This lets the service distinguish undefined from null — something plain
// WebDriver cannot do because both map to JSON null.
function unwrapEmbeddedResult<T>(raw: unknown): T {
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    const envelope = raw as Record<string, unknown>;
    if ('__wdio_value__' in envelope) {
      return envelope['__wdio_value__'] as T;
    }
    // Key absent: the result was undefined (omitted by JSON.stringify)
    return undefined as unknown as T;
  }
  return raw as T;
}
