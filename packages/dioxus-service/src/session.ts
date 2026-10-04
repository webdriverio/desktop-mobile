import {
  boundedOnComplete,
  createLogger,
  errorMessage,
  failStartup as failStartupShared,
  safeDeleteSession,
} from '@wdio/native-utils';
import type { Options } from '@wdio/types';
import { remote } from 'webdriverio';
import DioxusLaunchService from './launcher.js';
import DioxusWorkerService from './service.js';
import type { DioxusCapabilities, DioxusDriverProvider, DioxusServiceGlobalOptions } from './types.js';

const log = createLogger('dioxus-service', 'session');

const activeLaunchers = new WeakMap<WebdriverIO.Browser, DioxusLaunchService>();
const activeServices = new WeakMap<WebdriverIO.Browser, DioxusWorkerService>();

function failStartup(launcher: DioxusLaunchService, error: unknown, context: string): Promise<never> {
  return failStartupShared(error, 'Dioxus standalone', () =>
    boundedOnComplete(launcher, context, log, { rethrow: true }),
  );
}

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

  // remote() rejects non-W3C capability keys such as port and hostname.
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
  }).catch((error: unknown) => {
    log.error(`Failed to create remote session: ${errorMessage(error)}`);
    return failStartup(launcher, error, 'remote() cleanup');
  });

  activeLaunchers.set(browser, launcher);

  const service = new DioxusWorkerService(serviceOptions ?? {}, capabilities);
  try {
    await service.before(capabilities, [], browser);
  } catch (error) {
    await safeDeleteSession(browser, 'service.before cleanup', log);
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
    const service = activeServices.get(browser);
    try {
      await service?.after();
    } catch (e: unknown) {
      log.warn(`service.after() failed during cleanup: ${errorMessage(e)}`);
    }
    try {
      await service?.afterSession();
    } catch (e: unknown) {
      log.warn(`service.afterSession() failed during cleanup: ${errorMessage(e)}`);
    } finally {
      activeServices.delete(browser);
    }
    await boundedOnComplete(launcher, 'cleanup', log);
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
