import { createLogger } from '@wdio/native-utils';
import type { Options } from '@wdio/types';
import { remote } from 'webdriverio';
import DioxusLaunchService from './launcher.js';
import DioxusWorkerService from './service.js';
import type { DioxusCapabilities, DioxusDriverProvider, DioxusServiceGlobalOptions } from './types.js';

const log = createLogger('dioxus-service', 'session');

const activeLaunchers = new WeakMap<WebdriverIO.Browser, DioxusLaunchService>();

/**
 * Initialize Dioxus service in standalone mode.
 *
 * WDIO's `remote()` only invokes worker-level service hooks. This function
 * manually calls `launcher.onPrepare()` so the embedded WebDriver server is
 * started before the session is opened.
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
    throw new Error(
      'Dioxus driver port was not set on capabilities by onPrepare. ' +
        'This usually means the launcher failed to start the embedded WebDriver server.',
    );
  }

  log.debug(`Standalone connection: ${hostname}:${port}`);

  const serviceOptions = capabilities['wdio:dioxusServiceOptions'];
  const startTimeout = serviceOptions?.statusPollTimeout ?? 60_000;

  const browser = await remote({
    hostname,
    port,
    capabilities,
    connectionRetryTimeout: startTimeout * 4,
    connectionRetryCount: 10,
  }).catch((error: Error) => {
    log.error(`Failed to create remote session: ${error.message}`);
    throw error;
  });

  activeLaunchers.set(browser, launcher);

  const service = new DioxusWorkerService(serviceOptions ?? {}, capabilities);
  await service.before(capabilities, [], browser);

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
    await launcher.onComplete();
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
