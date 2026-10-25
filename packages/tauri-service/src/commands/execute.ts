import type { TauriAPIs, TauriExecuteOptions } from '@wdio/native-types';
import { createLogger } from '@wdio/native-utils';
import { DirectEvalClient } from '../directEvalClient.js';
import { isPluginAvailabilityCached, setPluginAvailabilityCached } from '../pluginCache.js';
import { getCurrentWindowLabel, getDefaultWindowLabel, getSessionProvider } from '../window.js';
import { wrapScriptForDirectEval } from '../wrapForDirectEval.js';

const log = createLogger('tauri-service', 'service');

const directEvalClientCache = new WeakMap<WebdriverIO.Browser, { client: DirectEvalClient; port: number }>();

function isExecuteOptions(arg: unknown): arg is TauriExecuteOptions {
  return typeof arg === 'object' && arg !== null && '__wdioOptions__' in arg;
}

const DIRECT_EVAL_PORT_ENV_VAR = 'TAURI_WEBDRIVER_PORT';
const DIRECT_EVAL_DEFAULT_PORT = 4445;

function getDirectEvalPort(browser: WebdriverIO.Browser): number {
  // /wdio/eval is served on the embedded WebDriver port, so the session's own port is authoritative
  const sessionPort = browser.options.port;
  if (sessionPort) {
    return sessionPort;
  }
  const envPort = process.env[DIRECT_EVAL_PORT_ENV_VAR];
  if (envPort) {
    const port = parseInt(envPort, 10);
    if (!Number.isNaN(port)) {
      return port;
    }
  }
  return DIRECT_EVAL_DEFAULT_PORT;
}

function getOrCreateDirectEvalClient(browser: WebdriverIO.Browser, port: number): DirectEvalClient {
  const cached = directEvalClientCache.get(browser);
  if (cached && cached.port === port) {
    return cached.client;
  }
  const client = new DirectEvalClient(port);
  directEvalClientCache.set(browser, { client, port });
  return client;
}

/**
 * Execute JavaScript code in the Tauri frontend context with access to Tauri APIs
 * Matches Electron's execute pattern: accepts functions or strings, passes Tauri APIs as first parameter
 *
 * Supports per-call options via TauriExecuteOptions:
 * - execute(browser, script, { windowLabel: 'settings' })
 * - execute(browser, script, { windowLabel: 'popup' }, arg1, arg2)
 */
export async function execute<ReturnValue, InnerArguments extends unknown[] = unknown[]>(
  browser: WebdriverIO.Browser,
  script: string | ((tauri: TauriAPIs, ...innerArgs: InnerArguments) => ReturnValue),
  ...args: InnerArguments
): Promise<ReturnValue> {
  if (!browser) {
    throw new Error('WDIO browser is not yet initialised');
  }

  const options: { windowLabel?: string } = {};

  const firstArg = args[0];
  let userArgs: unknown[];
  if (isExecuteOptions(firstArg)) {
    options.windowLabel = firstArg.windowLabel;
    userArgs = args.slice(1);
  } else {
    userArgs = args;
  }

  const sessionWindowLabel = getCurrentWindowLabel(browser);
  const defaultWindowLabel = getDefaultWindowLabel();
  const sessionWindowLabelIsExplicit = sessionWindowLabel !== defaultWindowLabel;
  const effectiveWindowLabel = options.windowLabel || sessionWindowLabel;

  // Only forward window_label when the user explicitly targeted a window
  // (per-call options or a prior switchWindow call), not when it's the initial default
  let executeOptions: { windowLabel?: string } = {};
  if (options.windowLabel) {
    executeOptions = { windowLabel: effectiveWindowLabel };
  } else if (sessionWindowLabelIsExplicit) {
    executeOptions = { windowLabel: sessionWindowLabel };
  }

  if (typeof script !== 'string' && typeof script !== 'function') {
    throw new Error('Expecting script to be type of "string" or "function"');
  }

  const provider = getSessionProvider(browser);

  if (provider === 'embedded') {
    const scriptString = typeof script === 'function' ? script.toString() : script;
    const port = getDirectEvalPort(browser);
    const client = getOrCreateDirectEvalClient(browser, port);
    const wrapped = wrapScriptForDirectEval(scriptString, JSON.stringify(userArgs));

    // On macOS the first direct eval against a freshly-spawned WKWebView can return the
    // opaque WKErrorJavaScriptExceptionOccurred ("A JavaScript exception occurred") before
    // the page's main world is fully ready. This shows up in standalone mode, where the
    // first tauri.execute runs seconds after launch — the test-runner path never hits it
    // because before() warms the webview first. A real script error surfaces its own
    // message through the wrapper's try/catch, so retrying only this opaque WebKit error
    // is safe. Tracking: webdriverio/desktop-mobile#540.
    const maxAttempts = 4;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return (await client.eval(wrapped, {
          windowLabel: executeOptions.windowLabel,
        })) as ReturnValue;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        // Only the *opaque* cold-webview error is retriable — the bare
        // "A JavaScript exception occurred. (code N)" with no detail. describe_ns_error
        // (macos.rs) enriches a genuine WKWebView exception with the real message/location
        // after the code (": …" / " @ line:col"), so an enriched message is a deterministic
        // error and must fail immediately rather than retry the full budget.
        const isOpaqueColdWebviewError =
          /javascript exception occurred/i.test(message) && !/\(code \d+\)\s*[:@]/.test(message);
        if (attempt >= maxAttempts || !isOpaqueColdWebviewError) {
          throw error;
        }
        log.warn(
          `Direct eval returned an opaque WebKit JS exception (attempt ${attempt}/${maxAttempts}); retrying: ${message}`,
        );
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
      }
    }
    throw lastError;
  }

  // Non-embedded path: use IPC via browser.execute (external/crabnebula providers)
  if (!isPluginAvailabilityCached(browser)) {
    const maxAttempts = 100;
    const retryInterval = 50;
    let pluginAvailable = false;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const result: unknown = await browser.execute(() => {
        // @ts-expect-error - Plugin API injected at runtime
        return typeof window.wdioTauri !== 'undefined' && typeof window.wdioTauri.execute === 'function';
      });
      pluginAvailable = result === true;

      if (pluginAvailable) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, retryInterval));
    }

    if (!pluginAvailable) {
      throw new Error(
        'Tauri plugin not available. Make sure @wdio/tauri-plugin is installed and registered in your Tauri app.',
      );
    }

    setPluginAvailabilityCached(browser);
    log.debug('Plugin availability cached for browser session');
  }

  const scriptString = typeof script === 'function' ? script.toString() : script;
  const argsJson = JSON.stringify(userArgs);

  const result = await browser.execute(
    async function executeWithinTauri(script: string, execOptions: { windowLabel?: string }, argsJson: string) {
      // @ts-expect-error - Running in browser context
      if (typeof window === 'undefined') {
        return JSON.stringify({ __wdio_error__: 'window is undefined' });
      }
      // @ts-expect-error - Running in browser context
      if (typeof window.wdioTauri === 'undefined') {
        return JSON.stringify({ __wdio_error__: 'window.wdioTauri is undefined' });
      }
      // @ts-expect-error - Running in browser context
      if (typeof window.wdioTauri.execute !== 'function') {
        // @ts-expect-error - Running in browser context
        return JSON.stringify({ __wdio_error__: `window.wdioTauri.execute is ${typeof window.wdioTauri.execute}` });
      }

      try {
        // @ts-expect-error - Running in browser context
        const execResult = window.wdioTauri.execute(script, execOptions, argsJson);
        if (execResult && typeof execResult.then === 'function') {
          try {
            const awaited = await execResult;
            if (
              awaited !== null &&
              typeof awaited === 'object' &&
              (awaited as { __wdio_undefined__?: boolean }).__wdio_undefined__ === true
            ) {
              return JSON.stringify({ __wdio_undefined__: true });
            }
            return JSON.stringify({ __wdio_value__: awaited });
          } catch (promiseError) {
            return JSON.stringify({
              __wdio_error__: `Promise error: ${promiseError instanceof Error ? promiseError.message : String(promiseError)}`,
            });
          }
        }
        if (
          execResult !== null &&
          typeof execResult === 'object' &&
          (execResult as { __wdio_undefined__?: boolean }).__wdio_undefined__ === true
        ) {
          return JSON.stringify({ __wdio_undefined__: true });
        }
        return JSON.stringify({ __wdio_value__: execResult });
      } catch (error) {
        return JSON.stringify({
          __wdio_error__: `Execute call error: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },
    scriptString,
    executeOptions,
    argsJson,
  );

  try {
    if (result && typeof result === 'string') {
      const parsed = JSON.parse(result) as {
        __wdio_error__?: string;
        __wdio_value__?: unknown;
        __wdio_undefined__?: boolean;
      };
      if (parsed.__wdio_error__) {
        throw new Error(parsed.__wdio_error__);
      }
      if (parsed.__wdio_undefined__) {
        return undefined as unknown as ReturnValue;
      }
      if (parsed.__wdio_value__ !== undefined) {
        return parsed.__wdio_value__ as ReturnValue;
      }
    }
  } catch (parseError) {
    throw new Error(
      `Failed to parse execute result: ${parseError instanceof Error ? parseError.message : String(parseError)}, raw result: ${result}`,
    );
  }

  return result as ReturnValue;
}
