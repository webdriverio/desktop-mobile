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
    // The wrapper body MUST stay synchronous: WebDriver's executeScript
    // wraps the string in a non-async function, so `await` here would be
    // a SyntaxError at runtime. Users that need promise-returning scripts
    // should reach for executeAsync (not yet exposed on browser.dioxus).
    const argsLiteral = args.map((a) => JSON.stringify(a) ?? 'undefined').join(', ');
    const wrapped = `
      const userFn = (${fnSource});
      const dx = window.__WDIO_DIOXUS__;
      if (!dx || typeof dx.invoke !== 'function') {
        throw new Error(
          '[wdio-dioxus-service] window.__WDIO_DIOXUS__.invoke is not installed. ' +
          'Did you forget to call wdio_dioxus_bridge::install(config) in your Dioxus main.rs?'
        );
      }
      return userFn(dx, ${argsLiteral});
    `;
    return (await browser.execute(wrapped)) as ReturnValue;
  }

  return (await browser.execute(script, ...args)) as ReturnValue;
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
  return browser.execute(`return (${script})()`) as Promise<T>;
}
