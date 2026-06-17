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

// Tracks which browser instances are using the embedded driver so that
// unwrapEmbeddedResult is only applied on that path. External WebDriver
// results are raw JS values and must not be treated as envelopes.
const embeddedBrowsers = new WeakSet<WebdriverIO.Browser>();

/**
 * Mark a browser session as using the embedded driver. Called by the worker
 * service during `before()` when `driverProvider === 'embedded'`. Once
 * marked, execute() and runInterceptorScript() unwrap the __wdio_value__
 * envelope that the embedded polling loop adds to every result.
 */
export function markAsEmbedded(browser: WebdriverIO.Browser): void {
  embeddedBrowsers.add(browser);
}

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
    return embeddedBrowsers.has(browser) ? unwrapEmbeddedResult<ReturnValue>(raw) : (raw as ReturnValue);
  }

  const raw = await browser.execute(script, ...args);
  return embeddedBrowsers.has(browser) ? unwrapEmbeddedResult<ReturnValue>(raw) : (raw as ReturnValue);
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
  return embeddedBrowsers.has(browser) ? unwrapEmbeddedResult<T>(raw) : (raw as T);
}

// The embedded polling loop wraps results in { __wdio_value__: result } so
// undefined can be distinguished from null across the JSON boundary.
// JSON.stringify omits undefined object properties, so:
//   undefined result → { __wdio_value__: undefined } → "{}" (key absent)
//   null result     → { __wdio_value__: null }      → '{"__wdio_value__":null}' (key present)
// This mirrors the pattern in @wdio/tauri-service.
function unwrapEmbeddedResult<T>(raw: unknown): T {
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    const envelope = raw as Record<string, unknown>;
    if ('__wdio_value__' in envelope) {
      return envelope['__wdio_value__'] as T;
    }
    // Key absent: JSON.stringify omitted it because the JS result was undefined
    return undefined as unknown as T;
  }
  return raw as T;
}
