import { createLogger } from '@wdio/native-utils';
import type { Options } from '@wdio/types';
import { remote } from 'webdriverio';
import DioxusLaunchService from './launcher.js';
import DioxusWorkerService from './service.js';
import type { DioxusCapabilities, DioxusDriverProvider, DioxusServiceGlobalOptions } from './types.js';

const log = createLogger('dioxus-service', 'session');

const activeLaunchers = new WeakMap<WebdriverIO.Browser, DioxusLaunchService>();
const activeServices = new WeakMap<WebdriverIO.Browser, DioxusWorkerService>();

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
    await launcher
      .onComplete()
      .catch((e: Error) => log.warn(`Failed to stop driver during port-check cleanup: ${e.message}`));
    throw new Error(
      'Dioxus driver port was not set on capabilities by onPrepare. ' +
        'This usually means the launcher failed to start the embedded WebDriver server.',
    );
  }

  log.debug(`Standalone connection: ${hostname}:${port}`);

  const serviceOptions = capabilities['wdio:dioxusServiceOptions'];
  const startTimeout = serviceOptions?.startTimeout ?? 60_000;

  // Strip non-W3C props that the launcher sets for its own connection bookkeeping.
  // webdriverio's remote() validates capabilities against the W3C spec and rejects
  // unknown keys like "port" and "hostname".
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
  }).catch(async (error: Error) => {
    log.error(`Failed to create remote session: ${error.message}`);
    await launcher
      .onComplete()
      .catch((cleanupErr: Error) => log.warn(`Failed to stop embedded driver during cleanup: ${cleanupErr.message}`));
    throw error;
  });

  activeLaunchers.set(browser, launcher);

  const service = new DioxusWorkerService(serviceOptions ?? {}, capabilities);
  try {
    await service.before(capabilities, [], browser);
  } catch (error) {
    await browser
      .deleteSession()
      .catch((e: Error) => log.warn(`Failed to delete session during service.before cleanup: ${e.message}`));
    await launcher
      .onComplete()
      .catch((e: Error) => log.warn(`Failed to stop embedded driver during service.before cleanup: ${e.message}`));
    activeLaunchers.delete(browser);
    throw error;
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
      log.warn(`service.after() failed during cleanup: ${(e as Error).message}`);
    }
    try {
      await service?.afterSession();
    } catch (e: unknown) {
      log.warn(`service.afterSession() failed during cleanup: ${(e as Error).message}`);
    } finally {
      activeServices.delete(browser);
    }
    await launcher
      .onComplete()
      .catch((e: Error) => log.warn(`launcher.onComplete() failed during cleanup: ${e.message}`));
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
