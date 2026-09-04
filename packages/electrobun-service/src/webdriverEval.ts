// W3C-WebDriver eval channel for the Linux WebKitGTK transport.
//
// The CDP path runs `execute`/`mock` scripts through the CdpBridge's
// `Runtime.evaluate`. On WebKitGTK there is no CDP — the worker's WDIO session IS the
// WebKitWebDriver session, so scripts run over W3C `/execute/async`. `WebDriverEvalBridge`
// exposes the one method those code paths use (`send('Runtime.evaluate', …)`), backed by
// `browser.executeAsync`, so the entire execute + mock + inner-recorder machinery is reused
// verbatim over W3C — no separate implementation, no divergence from the CDP surface.

import { createLogger } from '@wdio/native-utils';

import { SERVICE_NAME } from './constants.js';

const log = createLogger(SERVICE_NAME, 'bridge');

/** Outcome of evaluating an expression in the page (never throws for a page-level JS error). */
type EvalOutcome = { ok: true; value: unknown } | { ok: false; error: string };

/**
 * Evaluate an expression string in the app's realm over W3C `/execute/async` and resolve its
 * (awaited) value, or an error string for a page-level rejection. The expression is inlined
 * into the async script BODY (not `eval`/`Function`), so it works under a page CSP that forbids
 * `unsafe-eval`. `awaitPromise` semantics match CDP: the value is unwrapped from a Promise.
 */
async function runInPage(browser: WebdriverIO.Browser, expression: string): Promise<EvalOutcome> {
  // The W3C async script receives an injected callback as its last argument.
  const body =
    'var done = arguments[arguments.length - 1];' +
    `Promise.resolve().then(function () { return (${expression}); }).then(` +
    'function (v) { done({ ok: true, value: v }); },' +
    'function (e) { done({ ok: false, error: String((e && e.stack) || e) }); });';
  return (await browser.executeAsync(body)) as EvalOutcome;
}

/** The minimal CDP response shape `evaluateInActiveTarget` reads. */
interface RuntimeEvaluateResponse {
  result?: { value?: unknown };
  exceptionDetails?: { text?: string; exception?: { description?: string } };
}

/**
 * A CdpBridge-shaped adapter that satisfies the single method `execute`/`createMock` use
 * (`send('Runtime.evaluate', { expression })`). Passed where a `CdpBridge` is expected so the
 * CDP execute + mock code drives the app over W3C WebDriver unchanged.
 */
export class WebDriverEvalBridge {
  constructor(private readonly browser: WebdriverIO.Browser) {}

  async send(method: string, params: { expression: string }): Promise<RuntimeEvaluateResponse> {
    if (method !== 'Runtime.evaluate') {
      // execute/mock only ever call Runtime.evaluate; anything else is a wiring bug.
      throw new Error(`WebDriverEvalBridge supports only Runtime.evaluate over W3C, received: ${method}`);
    }
    const outcome = await runInPage(this.browser, params.expression);
    if (outcome.ok) {
      return { result: { value: outcome.value } };
    }
    // Page-level JS error → mirror CDP's exceptionDetails so the caller wraps it with context.
    return { exceptionDetails: { text: outcome.error, exception: { description: outcome.error } } };
  }
}

/**
 * Install a `console.*` shim in the app's page that buffers entries on
 * `window.__WDIO_ELECTROBUN_LOGS__`, and return a reader that drains the buffer and forwards
 * entries to the WDIO logger. Frontend log capture without CDP console events (the WebKitGTK
 * path has none). Best-effort: injection/read failures are logged, not fatal.
 */
export async function installConsoleShim(browser: WebdriverIO.Browser): Promise<() => Promise<void>> {
  const installScript =
    '(function () {' +
    '  if (window.__WDIO_ELECTROBUN_LOGS_INSTALLED__) { return true; }' +
    '  window.__WDIO_ELECTROBUN_LOGS_INSTALLED__ = true;' +
    '  window.__WDIO_ELECTROBUN_LOGS__ = [];' +
    "  ['log','info','warn','error','debug'].forEach(function (level) {" +
    '    var original = console[level] ? console[level].bind(console) : function () {};' +
    '    console[level] = function () {' +
    '      try {' +
    '        window.__WDIO_ELECTROBUN_LOGS__.push({ level: level, args: Array.prototype.map.call(arguments, String) });' +
    '      } catch (e) { /* ignore */ }' +
    '      original.apply(console, arguments);' +
    '    };' +
    '  });' +
    '  return true;' +
    '})()';
  try {
    await browser.execute(installScript);
  } catch (error) {
    log.warn(`Could not install the console shim: ${(error as Error).message}`);
  }

  return async function drain(): Promise<void> {
    try {
      const entries = (await browser.execute(
        'var l = window.__WDIO_ELECTROBUN_LOGS__ || []; window.__WDIO_ELECTROBUN_LOGS__ = []; return l;',
      )) as unknown as Array<{ level: string; args: string[] }>;
      for (const entry of entries ?? []) {
        const line = `[webview] ${entry.args.join(' ')}`;
        const level = entry.level === 'debug' ? 'debug' : entry.level === 'error' ? 'error' : 'info';
        (log as unknown as Record<string, (msg: string) => void>)[level]?.(line);
      }
    } catch (error) {
      log.debug(`Console shim drain failed: ${(error as Error).message}`);
    }
  };
}
