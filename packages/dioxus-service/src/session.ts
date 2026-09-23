import {
  createLogger,
  DEFAULT_TEARDOWN_TIMEOUT_MS,
  deleteSessionBounded,
  failStartup as failStartupShared,
  runBounded,
} from '@wdio/native-utils';
import type { Options } from '@wdio/types';
import { remote } from 'webdriverio';
import DioxusLaunchService from './launcher.js';
import DioxusWorkerService from './service.js';
import type { DioxusCapabilities, DioxusDriverProvider, DioxusServiceGlobalOptions } from './types.js';

const log = createLogger('dioxus-service', 'session');

const activeLaunchers = new WeakMap<WebdriverIO.Browser, DioxusLaunchService>();
const activeServices = new WeakMap<WebdriverIO.Browser, DioxusWorkerService>();

/**
 * onComplete stops a browser-mode dev server (no-op in native mode, where WDIO manages chromedriver),
 * bounded because a function-form devServer's user-supplied close() can hang.
 */
function boundedOnComplete(launcher: DioxusLaunchService, context: string): Promise<unknown> {
  return runBounded(
    () => launcher.onComplete(),
    DEFAULT_TEARDOWN_TIMEOUT_MS,
    () => log.warn(`launcher.onComplete() timed out during ${context}`),
  );
}

function failStartup(launcher: DioxusLaunchService, error: unknown, context: string): Promise<never> {
  return failStartupShared(error, 'Dioxus standalone', () => boundedOnComplete(launcher, context));
}

/**
 * WDIO's `remote()` runs only worker hooks, so init() manually calls `launcher.onPrepare()` to start
 * the embedded WebDriver server before opening the session.
 */
export async function init(
  capabilities: DioxusCapabilities,
  globalOptions?: DioxusServiceGlobalOptions,
): Promise<WebdriverIO.Browser> {
  log.debug('Initializing Dioxus service in standalone mode…');

  const testRunnerOpts = { capabilities: [] } as unknown as Options.Testrunner;
  const launcher = new DioxusLaunchService(globalOptions ?? {}, capabilities, testRunnerOpts);

  await launcher.onPrepare(testRunnerOpts, [capabilities]);

  const hostname = (capabilities as { hostname?: string }).hostname ?? '127.0.0.1';
  const port = (capabilities as { port?: number }).port;
  if (!port) {
    return failStartup(
      launcher,
      new Error(
        'Dioxus driver port was not set on capabilities by onPrepare. ' +
          'This usually means the launcher failed to start the embedded WebDriver server.',
      ),
      'port-check cleanup',
    );
  }

  log.debug(`Standalone connection: ${hostname}:${port}`);

  const serviceOptions = capabilities['wdio:dioxusServiceOptions'];
  const startTimeout = serviceOptions?.startTimeout ?? 60_000;

  // Webdriverio's remote() validates capabilities against the W3C spec and rejects
  // unknown keys like "port" and "hostname" - strip them.
  const driverCapabilities = structuredClone(capabilities);
  delete (driverCapabilities as { port?: number }).port;
  delete (driverCapabilities as { hostname?: string }).hostname;
  delete (driverCapabilities as { browserName?: string }).browserName;

  const browser = await remote({
    hostname,
    port,
    capabilities: driverCapabilities,
    connectionRetryTimeout: startTimeout * 4,
    connectionRetryCount: 10,
  }).catch((error: Error) => {
    log.error(`Failed to create remote session: ${error.message}`);
    return failStartup(launcher, error, 'remote() cleanup');
  });

  activeLaunchers.set(browser, launcher);

  const service = new DioxusWorkerService(serviceOptions ?? {}, capabilities);
  try {
    await service.before(capabilities, [], browser);
  } catch (error) {
    await deleteSessionBounded(browser, 'service.before cleanup', log);
    activeLaunchers.delete(browser);
    return failStartup(launcher, error, 'service.before cleanup');
  }
  activeServices.set(browser, service);

  log.debug('Dioxus standalone session initialised');
  return browser;
}

/**
 * Clean up a standalone Dioxus session created by `init()`.
 */
export async function cleanup(browser: WebdriverIO.Browser): Promise<void> {
  log.debug('Cleaning up Dioxus standalone session…');

  const launcher = activeLaunchers.get(browser);
  if (launcher) {
    // WDIO's standalone remote() never runs the worker after/afterSession hooks, so cleanup() drives
    // them manually - else mock/window state leaks between sequential standalone sessions.
    const service = activeServices.get(browser);
    try {
      await service?.after();
    } catch (e: unknown) {
      log.warn(`service.after() failed during cleanup: ${(e as Error).message}`);
    }
    try {
      await service?.afterSession();
    } catch (e: unknown) {
      log.warn(`service.afterSession() failed during cleanup: ${(e as Error).message}`);
    } finally {
      activeServices.delete(browser);
    }
    await boundedOnComplete(launcher, 'cleanup').catch((e: Error) =>
      log.warn(`launcher.onComplete() failed during cleanup: ${e.message}`),
    );
    activeLaunchers.delete(browser);
    log.debug('Dioxus standalone session cleaned up');
  } else {
    log.warn('No launcher found for this browser instance');
  }
}

/**
 * Build a minimal DioxusCapabilities object for standalone use.
 */
export function createDioxusCapabilities(
  appBinaryPath: string,
  options: {
    appArgs?: string[];
    driverProvider?: DioxusDriverProvider;
    embeddedPort?: number;
    captureBackendLogs?: boolean;
    captureFrontendLogs?: boolean;
  } = {},
): DioxusCapabilities {
  return {
    browserName: 'dioxus',
    'dioxus:options': {
      application: appBinaryPath,
      args: options.appArgs ?? [],
    },
    'wdio:dioxusServiceOptions': {
      appBinaryPath,
      appArgs: options.appArgs ?? [],
      driverProvider: options.driverProvider ?? 'embedded',
      embeddedPort: options.embeddedPort,
      captureBackendLogs: options.captureBackendLogs ?? false,
      captureFrontendLogs: options.captureFrontendLogs ?? false,
    },
  };
}
