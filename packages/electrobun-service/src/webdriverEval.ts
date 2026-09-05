// W3C-WebDriver eval channel for the Linux WebKitGTK transport.
//
// The CDP path runs `execute`/`mock` scripts through the CdpBridge's `Runtime.evaluate`. On
// WebKitGTK there is no CDP — scripts run over W3C `/execute/async`. `WebDriverEvalBridge`
// exposes the one method those code paths use (`send('Runtime.evaluate', …)`), so the entire
// execute + mock + inner-recorder machinery is reused verbatim over W3C.
//
// IMPORTANT: it posts to `/execute/async` DIRECTLY (raw HTTP), not via WDIO's
// `browser.executeAsync`/`executeAsyncScript`. WDIO wraps the script and turns a page-level
// throw into a WebDriverError that surfaces the JSC stack (which omits the message), breaking
// error propagation. The raw endpoint honours our in-page `try/catch → done({ok,error})`
// protocol and returns a clean message — verified against WebKitWebDriver directly.

import http from 'node:http';
import https from 'node:https';

import { createLogger } from '@wdio/native-utils';

import { SERVICE_NAME } from './constants.js';

const log = createLogger(SERVICE_NAME, 'bridge');

/** Outcome our in-page script resolves `done` with (never a raw throw — WebKit reports those). */
type EvalOutcome = { ok: true; value: unknown; undef?: boolean } | { ok: false; error: string };

export type ExecuteAsyncPoster = (script: string) => Promise<{ value: unknown }>;

interface RuntimeEvaluateResponse {
  result?: { value?: unknown };
  exceptionDetails?: { text?: string; exception?: { description?: string } };
}

/**
 * Wrap an expression so it ALWAYS calls `done` with an outcome — never lets an exception reach the
 * automation context (WebKit reports any throw as a command error). `undef` flags a genuine
 * `undefined` (WebDriver would otherwise serialise it as `null`).
 */
function buildScript(expression: string): string {
  return (
    'var done = arguments[arguments.length - 1];' +
    '(async function () {' +
    `  try { var v = await (${expression}); done({ ok: true, value: v, undef: v === undefined }); }` +
    '  catch (e) { done({ ok: false, error: e && e.message ? String(e.message) : String(e) }); }' +
    '})().catch(function (e) { done({ ok: false, error: e && e.message ? String(e.message) : String(e) }); });'
  );
}

export function httpExecuteAsyncPoster(baseUrl: string, sessionId: string): ExecuteAsyncPoster {
  const transport = baseUrl.startsWith('https') ? https : http;
  return (script) =>
    new Promise((resolve, reject) => {
      const url = new URL(`session/${sessionId}/execute/async`, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
      const data = Buffer.from(JSON.stringify({ script, args: [] }));
      const request = transport.request(
        url,
        { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': data.length } },
        (res) => {
          let buf = '';
          res.on('data', (chunk) => (buf += chunk));
          res.on('end', () => {
            try {
              resolve(JSON.parse(buf || '{}') as { value: unknown });
            } catch (error) {
              reject(new Error(`Invalid /execute/async response: ${(error as Error).message}`));
            }
          });
        },
      );
      request.on('error', reject);
      request.setTimeout(120_000, () => request.destroy(new Error('execute/async request timed out')));
      request.write(data);
      request.end();
    });
}

export class WebDriverEvalBridge {
  constructor(private readonly post: ExecuteAsyncPoster) {}

  async send(method: string, params: { expression: string }): Promise<RuntimeEvaluateResponse> {
    if (method !== 'Runtime.evaluate') {
      throw new Error(`WebDriverEvalBridge supports only Runtime.evaluate over W3C, received: ${method}`);
    }
    const response = await this.post(buildScript(params.expression));
    const value = response?.value;
    if (value && typeof value === 'object' && 'ok' in value) {
      const outcome = value as EvalOutcome;
      if (outcome.ok) {
        return { result: { value: outcome.undef ? undefined : outcome.value } };
      }
      return { exceptionDetails: { text: outcome.error, exception: { description: outcome.error } } };
    }
    // A W3C error response (non-200): a sync/parse error not caught by our in-page try/catch.
    const message = (value as { message?: string } | undefined)?.message ?? 'unknown W3C script error';
    return { exceptionDetails: { text: message, exception: { description: message } } };
  }
}

export function createWebDriverEvalBridge(browser: WebdriverIO.Browser): WebDriverEvalBridge {
  const options = browser.options as { protocol?: string; hostname?: string; port?: number; path?: string };
  const protocol = options.protocol ?? 'http';
  const hostname = options.hostname ?? '127.0.0.1';
  const port = options.port ?? 4444;
  const baseUrl = `${protocol}://${hostname}:${port}`;
  return new WebDriverEvalBridge(httpExecuteAsyncPoster(baseUrl, browser.sessionId));
}

/**
 * Frontend log capture without CDP console events. Unlike the eval channel above, these scripts
 * never throw, so plain `browser.execute` is fine.
 *
 * NOTE: the shim is per-document — a full-page navigation resets `window`, so entries logged
 * before a navigation are lost from the buffer. Cross-navigation frontend logs still surface via
 * the driver's stdout (electrobun forwards `console.*` there), which the launcher pipes to the logger.
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
        const level = ['debug', 'info', 'warn', 'error'].includes(entry.level) ? entry.level : 'info';
        (log as unknown as Record<string, (msg: string) => void>)[level]?.(line);
      }
    } catch (error) {
      log.debug(`Console shim drain failed: ${(error as Error).message}`);
    }
  };
}
