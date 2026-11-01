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
//   - `runInterceptorScript`: runs DioxusAdapter's mock scripts, which are
//     function literals, so it calls them with `window.__WDIO_DIOXUS__`.
//
// No per-call windowLabel option yet (#722): scripts run in the current window.

import type { DioxusAPIs } from '@wdio/native-types';

// Sessions on the embedded driver, where function-form execute() results come back in the envelope.
const embeddedBrowsers = new WeakSet<WebdriverIO.Browser>();

export function markAsEmbedded(browser: WebdriverIO.Browser): void {
  embeddedBrowsers.add(browser);
}

export async function execute<ReturnValue, InnerArguments extends unknown[] = unknown[]>(
  browser: WebdriverIO.Browser,
  script: string | ((dx: DioxusAPIs, ...args: InnerArguments) => ReturnValue),
  ...args: InnerArguments
): Promise<Awaited<ReturnValue>> {
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
    // For the embedded driver the guest-js AsyncFunction loop awaits the
    // returned Promise. We resolve with {__wdio_value__: r} so undefined
    // (key absent in JSON.stringify) is distinguishable from null (key
    // present). External WebDriver resolves Promises natively; no envelope.
    const isEmbedded = embeddedBrowsers.has(browser);
    const thenResolve = isEmbedded ? 'function(__r){resolve({__wdio_value__:__r});}' : 'resolve';
    const wrapped = `
      const userFn = (${fnSource});
      const dx = window.__WDIO_DIOXUS__;
      if (!dx || typeof dx.invoke !== 'function') {
        throw new Error(
          '[wdio-dioxus-service] window.__WDIO_DIOXUS__.invoke is not installed. ' +
          'Did you forget to call wdio_dioxus::install(config) in your Dioxus main.rs?'
        );
      }
      return new Promise(function (resolve, reject) {
        try {
          Promise.resolve(userFn(dx, ${argsLiteral})).then(${thenResolve}, reject);
        } catch (e) {
          reject(e);
        }
      });
    `;
    const raw = await browser.execute(wrapped);
    return isEmbedded ? unwrapEnvelope<Awaited<ReturnValue>>(raw) : (raw as Awaited<ReturnValue>);
  }

  // String-form scripts are passed through without an envelope. The embedded
  // driver runs them as plain IIFEs; unwrapping here would corrupt any plain
  // object result. String-form cannot distinguish undefined from null on the
  // embedded driver — use function-form if that matters.
  const raw = await browser.execute(script, ...args);
  return raw as Awaited<ReturnValue>;
}

// Errors come back in the envelope too: a script that rejected would surface as a
// WebDriver error whose message quotes the whole script.
export async function runInterceptorScript<T>(browser: WebdriverIO.Browser, script: string): Promise<T> {
  const raw = await browser.execute(
    `return Promise.resolve().then(function () { return (${script})(window.__WDIO_DIOXUS__); }).then(` +
      'function (r) { return { __wdio_value__: r }; }, ' +
      'function (e) { return { __wdio_error__: e instanceof Error ? e.message : String(e) }; })',
  );
  // The multiremote root runs the script in every instance and returns one envelope each.
  return (Array.isArray(raw) ? raw.map(unwrapOrThrow) : unwrapOrThrow(raw)) as T;
}

function unwrapOrThrow(envelope: unknown): unknown {
  if (envelope !== null && typeof envelope === 'object' && '__wdio_error__' in envelope) {
    throw new Error(String(envelope.__wdio_error__));
  }
  return unwrapEnvelope(envelope);
}

// The envelope tells undefined from null: JSON drops an undefined property, so `{}` means undefined.
function unwrapEnvelope<T>(raw: unknown): T {
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    const envelope = raw as Record<string, unknown>;
    if ('__wdio_value__' in envelope) {
      return envelope.__wdio_value__ as T;
    }
    return undefined as unknown as T;
  }
  return raw as T;
}
