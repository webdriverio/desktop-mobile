import type { TauriAPIs, TauriExecuteOptions } from '@wdio/native-types';
import { createLogger } from '@wdio/native-utils';
import { DirectEvalClient } from '../directEvalClient.js';
import { isPluginAvailabilityCached, setPluginAvailabilityCached } from '../pluginCache.js';
import type { TauriCommandContext, TauriResult } from '../types.js';
import { getCurrentWindowLabel, getDefaultWindowLabel, getSessionProvider } from '../window.js';
import { wrapScriptForDirectEval } from '../wrapForDirectEval.js';

export { clearPluginAvailabilityCache } from '../pluginCache.js';

const log = createLogger('tauri-service', 'service');

const directEvalClientCache = new WeakMap<WebdriverIO.Browser, { client: DirectEvalClient; port: number }>();

function isExecuteOptions(arg: unknown): arg is TauriExecuteOptions {
  return typeof arg === 'object' && arg !== null && '__wdioOptions__' in arg;
}

const DIRECT_EVAL_PORT_ENV_VAR = 'TAURI_WEBDRIVER_PORT';
const DIRECT_EVAL_DEFAULT_PORT = 4445;

function getDirectEvalPort(): number {
  const envPort = process.env[DIRECT_EVAL_PORT_ENV_VAR];
  if (envPort) {
    const port = parseInt(envPort, 10);
    if (!Number.isNaN(port)) return port;
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
    const port = getDirectEvalPort();
    const client = getOrCreateDirectEvalClient(browser, port);
    const wrapped = wrapScriptForDirectEval(scriptString, JSON.stringify(userArgs));
    return (await client.eval(wrapped, {
      windowLabel: executeOptions.windowLabel,
    })) as ReturnValue;
  }

  // Non-embedded path: use IPC via browser.execute (official/crabnebula providers)
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

/**
 * Execute a Tauri command (legacy method - kept for backward compatibility)
 * @deprecated Use execute() instead
 */
export async function executeTauriCommand<T = unknown>(
  browser: WebdriverIO.Browser,
  command: string,
  ...args: unknown[]
): Promise<TauriResult<T>> {
  log.debug(`Executing Tauri command: ${command} with args:`, args);

  try {
    const result = await execute(
      browser,
      ({ core }, invokeCommand: string, invokeArgs: unknown[]) => core.invoke(invokeCommand, ...invokeArgs),
      command,
      args,
    );

    return {
      ok: true,
      value: result as T,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`Tauri command failed: ${errorMessage}`);

    return {
      ok: false,
      error: errorMessage,
    };
  }
}

/**
 * Execute a Tauri command with timeout
 */
export async function executeTauriCommandWithTimeout<T = unknown>(
  browser: WebdriverIO.Browser,
  command: string,
  timeout: number = 30000,
  ...args: unknown[]
): Promise<TauriResult<T>> {
  log.debug(`Executing Tauri command with timeout ${timeout}ms: ${command}`);

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Tauri command timeout after ${timeout}ms`));
    }, timeout);
  });

  try {
    const result = await Promise.race([executeTauriCommand<T>(browser, command, ...args), timeoutPromise]);

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error(`Tauri command timeout or error: ${errorMessage}`);

    return {
      ok: false,
      error: errorMessage,
    };
  }
}

/**
 * Execute multiple Tauri commands in sequence
 */
export async function executeTauriCommands<T = unknown>(
  browser: WebdriverIO.Browser,
  commands: TauriCommandContext[],
): Promise<TauriResult<T>[]> {
  log.debug(`Executing ${commands.length} Tauri commands in sequence`);

  const results: TauriResult<T>[] = [];

  for (const { command, args, timeout } of commands) {
    const result = timeout
      ? await executeTauriCommandWithTimeout<T>(browser, command, timeout, ...args)
      : await executeTauriCommand<T>(browser, command, ...args);

    results.push(result);

    if (!result.ok) {
      log.warn(`Stopping command execution due to failure: ${result.error}`);
      break;
    }
  }

  return results;
}

/**
 * Execute Tauri commands in parallel
 */
export async function executeTauriCommandsParallel<T = unknown>(
  browser: WebdriverIO.Browser,
  commands: TauriCommandContext[],
): Promise<TauriResult<T>[]> {
  log.debug(`Executing ${commands.length} Tauri commands in parallel`);

  const promises = commands.map(({ command, args, timeout }) =>
    timeout
      ? executeTauriCommandWithTimeout<T>(browser, command, timeout, ...args)
      : executeTauriCommand<T>(browser, command, ...args),
  );

  return Promise.all(promises);
}

/**
 * Check if Tauri API is available
 */
export async function isTauriApiAvailable(browser: WebdriverIO.Browser): Promise<boolean> {
  try {
    const result = await browser.execute(() => {
      // @ts-expect-error - Tauri API injected at runtime
      return typeof window.__TAURI__ !== 'undefined';
    });

    return Boolean(result);
  } catch (error) {
    log.debug(`Tauri API not available: ${error}`);
    return false;
  }
}

/**
 * Get Tauri version
 */
export async function getTauriVersion(browser: WebdriverIO.Browser): Promise<TauriResult<string>> {
  return executeTauriCommand<string>(browser, 'get_tauri_version');
}

/**
 * Get Tauri app information
 */
export async function getTauriAppInfo(
  browser: WebdriverIO.Browser,
): Promise<TauriResult<{ name: string; version: string }>> {
  return executeTauriCommand<{ name: string; version: string }>(browser, 'get_app_info');
}
