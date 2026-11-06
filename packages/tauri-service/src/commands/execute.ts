import type { Result, TauriAPIs, TauriExecuteOptions } from '@wdio/native-types';
import { createLogger } from '@wdio/native-utils';
import { DirectEvalClient } from '../directEvalClient.js';
import { hasReference, toElementReferences } from '../elementReferences.js';
import { isPluginAvailabilityCached, setPluginAvailabilityCached } from '../pluginCache.js';
import { CONSOLE_WRAPPER_SCRIPT } from '../scripts/console-wrapper.js';
import { getCurrentWindowLabel, getDefaultWindowLabel, getSessionProvider } from '../windowState.js';
import { wrapScriptForDirectEval, wrapScriptForPluginIpc, wrapScriptForWebDriver } from '../wrapForDirectEval.js';

const log = createLogger('tauri-service', 'service');

type ScriptOutcome = Result<unknown, string> & { undef?: boolean };

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

type Script<ReturnValue, InnerArguments extends unknown[]> =
  | string
  | ((tauri: TauriAPIs, ...innerArgs: InnerArguments) => ReturnValue);

// For the service's own scripts, which never need element references
export async function execute<ReturnValue, InnerArguments extends unknown[] = unknown[]>(
  browser: WebdriverIO.Browser,
  script: Script<ReturnValue, InnerArguments>,
  ...args: InnerArguments
): Promise<Awaited<ReturnValue>> {
  return runScript(browser, script, args, false);
}

// For browser.tauri.execute(): on the embedded provider, the plugin turns nodes in the result into references in
// the session, and references in the arguments into nodes
export async function executeWithElementRefs<ReturnValue, InnerArguments extends unknown[] = unknown[]>(
  browser: WebdriverIO.Browser,
  script: Script<ReturnValue, InnerArguments>,
  ...args: InnerArguments
): Promise<Awaited<ReturnValue>> {
  return runScript(browser, script, args, true);
}

async function runScript<ReturnValue, InnerArguments extends unknown[]>(
  browser: WebdriverIO.Browser,
  script: Script<ReturnValue, InnerArguments>,
  args: InnerArguments,
  elementRefs: boolean,
): Promise<Awaited<ReturnValue>> {
  if (!browser) {
    throw new Error('WDIO browser is not yet initialised');
  }

  const options: { windowLabel?: string } = {};

  const firstArg = args[0];
  let userArgs: unknown[];
  if (isExecuteOptions(firstArg)) {
    options.windowLabel = firstArg.windowLabel;
    userArgs = toElementReferences(args.slice(1));
  } else {
    userArgs = toElementReferences(args);
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
    const argsJson = JSON.stringify(userArgs);
    const wrapped = wrapScriptForDirectEval(scriptString, argsJson);
    // Send a second copy of the arguments only when the plugin has a reference to resolve: the copy could
    // push big arguments over its request size limit
    const refs = elementRefs
      ? { sessionId: browser.sessionId, args: hasReference(argsJson) ? userArgs : undefined }
      : {};

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
          ...refs,
        })) as Awaited<ReturnValue>;
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

  // External and CrabNebula providers: the script runs through the WebDriver session
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
  const wrapped = elementRefs
    ? wrapScriptForWebDriver(scriptString, userArgs, executeOptions.windowLabel)
    : wrapScriptForPluginIpc(scriptString, JSON.stringify(userArgs), executeOptions.windowLabel);
  const outcome = (await browser.executeAsyncScript(
    `${CONSOLE_WRAPPER_SCRIPT}\n${wrapped.script}`,
    wrapped.args as Parameters<WebdriverIO.Browser['executeAsyncScript']>[1],
  )) as ScriptOutcome;
  if (!outcome.ok) {
    throw new Error(outcome.error);
  }
  return (outcome.undef ? undefined : outcome.value) as Awaited<ReturnValue>;
}
