// browser.dioxus.execute implementation.
//
// Phase 2 MVP: minimum viable execute that wraps WDIO's `browser.execute` and
// exposes the bridge's `window.__WDIO_DIOXUS__` to the script as `dx`. Mirrors
// the public surface of `browser.tauri.execute(...)` but without the
// windowLabel sentinel + multi-window routing (those land in a Phase 4 commit
// alongside the bridge's window_state module).
//
// Accepts either a function or a raw string script. Function form is
// serialised to its source representation and wrapped so it receives
// `(dx, ...args)`. String form is passed through unchanged with `arguments`
// being the WDIO-supplied args.

import type { DioxusAPIs } from '@wdio/native-types';

export async function execute<ReturnValue, InnerArguments extends unknown[] = unknown[]>(
  browser: WebdriverIO.Browser,
  script: string | ((dx: DioxusAPIs, ...args: InnerArguments) => ReturnValue | Promise<ReturnValue>),
  ...args: InnerArguments
): Promise<ReturnValue> {
  if (typeof script === 'function') {
    const fnSource = script.toString();
    const wrapped = `
      const userFn = (${fnSource});
      const dx = window.__WDIO_DIOXUS__;
      if (!dx || typeof dx.invoke !== 'function') {
        throw new Error(
          '[wdio-dioxus-service] window.__WDIO_DIOXUS__.invoke is not installed. ' +
          'Did you forget to call wdio_dioxus_bridge::install(config) in your Dioxus main.rs?'
        );
      }
      return await Promise.resolve(userFn(dx, ...arguments));
    `;
    return (await browser.execute(wrapped, ...args)) as ReturnValue;
  }

  return (await browser.execute(script, ...args)) as ReturnValue;
}
