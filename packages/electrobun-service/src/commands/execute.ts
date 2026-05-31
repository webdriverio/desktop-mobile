// browser.electrobun.execute implementation.
//
// Electrobun is CDP-attach: there is no WebDriver executeScript channel for the
// app's webview, so we run the user's code directly in the active CEF content
// target via the CdpBridge's `Runtime.evaluate`. A string-built IIFE is built
// from the user's function source (no Electron-style recast machinery needed for
// MVP), with args inlined as JSON literals. The first callback arg is the
// in-webview surface `window.__WDIO_ELECTROBUN__` (may be `{}` for MVP).
//
// Invariant: this never issues Page.navigate — the bridge only enables Runtime
// on the live target (see @wdio/electrobun-cdp-bridge).

import type { CdpBridge } from '@wdio/electrobun-cdp-bridge';
import type { ElectrobunAPIs } from '@wdio/native-types';

interface RemoteObject {
  type?: string;
  value?: unknown;
  description?: string;
}

interface EvaluateResponse {
  result?: RemoteObject;
  exceptionDetails?: {
    text?: string;
    exception?: { description?: string; value?: unknown };
  };
}

function inlineArgs(args: unknown[]): string {
  return args
    .map((arg, index) => {
      // JSON.stringify(fn) / JSON.stringify(symbol) returns `undefined` rather
      // than throwing, which would silently drop the arg — reject those up front.
      if (typeof arg === 'function' || typeof arg === 'symbol') {
        throw new Error(
          `browser.electrobun.execute argument at index ${index} is not JSON-serialisable ` +
            `(a ${typeof arg} cannot be inlined into the script source; JSON.stringify would silently drop it).`,
        );
      }
      try {
        return JSON.stringify(arg) ?? 'undefined';
      } catch (err) {
        throw new Error(
          `browser.electrobun.execute argument at index ${index} is not JSON-serialisable ` +
            '(args are inlined into the script source via JSON.stringify). This typically means the ' +
            `value contains a circular reference, a BigInt, or a function. Underlying error: ${(err as Error).message}`,
        );
      }
    })
    .join(', ');
}

/**
 * Run a user function (or raw expression string) in the active Electrobun content
 * target and return its (JSON-serialisable) result.
 *
 * Function form: the source is wrapped in an async IIFE that passes
 * `window.__WDIO_ELECTROBUN__` (defaulting to `{}`) as the first arg, then the
 * inlined user args. String form: evaluated as-is (standard expression).
 */
export async function execute<ReturnValue, InnerArguments extends unknown[] = unknown[]>(
  bridge: CdpBridge,
  script: string | ((eb: ElectrobunAPIs, ...args: InnerArguments) => ReturnValue),
  ...args: InnerArguments
): Promise<ReturnValue> {
  const expression =
    typeof script === 'function'
      ? `(async () => {
          const userFn = (${script.toString()});
          const eb = window.__WDIO_ELECTROBUN__ || {};
          return await userFn(eb, ${inlineArgs(args)});
        })()`
      : script;

  const response = (await bridge.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })) as EvaluateResponse;

  if (response.exceptionDetails) {
    const detail =
      response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? 'Unknown evaluation error';
    throw new Error(`browser.electrobun.execute failed: ${detail}`);
  }

  return response.result?.value as ReturnValue;
}
