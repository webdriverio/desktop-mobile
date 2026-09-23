import { getLogWriter } from '@wdio/native-core';
import type {
  ElectronServiceCapabilities,
  ElectronServiceGlobalOptions,
  ElectronServiceOptions,
  ElectronStandaloneCapability,
} from '@wdio/native-types';
import {
  boundedOnComplete,
  createLogger,
  failStartup as failStartupShared,
  safeDeleteSession,
} from '@wdio/native-utils';

const log = createLogger('electron-service', 'service');

import type { Options } from '@wdio/types';
import { remote } from 'webdriverio';
import ElectronLaunchService from './launcher.js';
import ElectronWorkerService from './service.js';

const activeLaunchers = new WeakMap<WebdriverIO.Browser, ElectronLaunchService>();
const activeServices = new WeakMap<WebdriverIO.Browser, ElectronWorkerService>();

function failStartup(launcher: ElectronLaunchService, error: unknown): Promise<never> {
  const writer = getLogWriter('electron-service');
  return failStartupShared(
    error,
    'Electron standalone',
    () => writer.close(),
    () => boundedOnComplete(launcher, 'startup cleanup', log, { rethrow: true }),
  );
}

export async function init(
  capabilities: ElectronServiceCapabilities,
  globalOptions?: ElectronServiceGlobalOptions,
): Promise<WebdriverIO.Browser> {
  log.debug('Initializing Electron service in standalone mode...');

  const capability = Array.isArray(capabilities) ? capabilities[0] : capabilities;

  const serviceOptions = (capability as Record<string, unknown>)['wdio:electronServiceOptions'] as
    | ElectronServiceOptions
    | undefined;
  if (serviceOptions?.captureMainProcessLogs || serviceOptions?.captureRendererLogs) {
    if (serviceOptions.logDir) {
      const writer = getLogWriter('electron-service');
      writer.initialize(serviceOptions.logDir);
      log.debug(`Standalone log writer initialized at ${writer.getLogDir()}`);
    } else {
      log.warn('Standalone logging enabled but logDir not specified - logs will not be captured');
    }
  }

  const testRunnerOpts: Options.Testrunner = (globalOptions?.rootDir
    ? { rootDir: globalOptions.rootDir }
    : {}) as unknown as Options.Testrunner;
  const launcher = new ElectronLaunchService(
    globalOptions || {},
    capability as ElectronServiceCapabilities,
    testRunnerOpts,
  );

  await launcher.onPrepare(testRunnerOpts, [capability] as ElectronServiceCapabilities);

  await launcher.onWorkerStart('', [capability] as WebdriverIO.Capabilities);

  log.debug('Session capabilities:', JSON.stringify(capability, null, 2));

  const service = new ElectronWorkerService(globalOptions, capability);

  const browser = await remote({
    capabilities: capability,
  }).catch((error: Error) => {
    log.error(`Failed to create remote session: ${error.message}`);
    return failStartup(launcher, error);
  });

  activeLaunchers.set(browser, launcher);

  try {
    await service.before(capability, [], browser);
  } catch (error) {
    // remote() already opened the session, so close it here before the failure propagates.
    await safeDeleteSession(browser, 'service.before cleanup', log);
    activeLaunchers.delete(browser);
    return failStartup(launcher, error);
  }
  activeServices.set(browser, service);

  log.debug('Electron standalone session initialized');
  return browser;
}

/**
 * Clean up Electron service for a standalone session
 * Call this when you're done with a browser instance created via init()
 */
export async function cleanup(browser: WebdriverIO.Browser): Promise<void> {
  log.debug('Cleaning up Electron standalone session...');

  const launcher = activeLaunchers.get(browser);
  if (launcher) {
    // WDIO's standalone remote() never runs the worker after/afterSession hooks, so mock state would
    // leak between sequential sessions.
    const service = activeServices.get(browser);
    // Safe without WDIO's hook args: the impls ignore them.
    const svc = service as unknown as
      | { after?: () => void | Promise<void>; afterSession?: () => Promise<void> }
      | undefined;
    try {
      await svc?.after?.();
    } catch (e) {
      log.warn(`service.after() failed during cleanup: ${(e as Error).message}`);
    }
    try {
      await svc?.afterSession?.();
    } catch (e) {
      log.warn(`service.afterSession() failed during cleanup: ${(e as Error).message}`);
    } finally {
      activeServices.delete(browser);
    }

    await safeDeleteSession(browser, 'cleanup', log);

    await boundedOnComplete(launcher, 'cleanup', log);

    const writer = getLogWriter('electron-service');
    await writer.close().catch((e: Error) => log.warn(`Failed to close log writer during cleanup: ${e.message}`));
    activeLaunchers.delete(browser);
    log.debug('Electron standalone session cleaned up');
  } else {
    log.warn('No launcher found for this browser instance');
  }
}

/**
 * Create Electron capabilities for standalone mode
 */
export function createElectronCapabilities(options: ElectronServiceOptions): ElectronStandaloneCapability {
  if (!options.appBinaryPath && !options.appEntryPoint) {
    throw new Error('Either appBinaryPath or appEntryPoint must be provided');
  }

  const capability: ElectronStandaloneCapability = {
    browserName: 'electron',
    'wdio:electronServiceOptions': { ...options },
  };

  if (options.appBinaryPath) {
    capability['goog:chromeOptions'] = {
      binary: options.appBinaryPath,
      args: options.appArgs || [],
    };
  }

  return capability;
}
