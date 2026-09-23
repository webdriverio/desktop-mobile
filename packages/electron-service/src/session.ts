import { getLogWriter } from '@wdio/native-core';
import type {
  ElectronServiceCapabilities,
  ElectronServiceGlobalOptions,
  ElectronServiceOptions,
  ElectronStandaloneCapability,
} from '@wdio/native-types';
import {
  createLogger,
  DEFAULT_TEARDOWN_TIMEOUT_MS,
  failStartup as failStartupShared,
  isBenignTeardownError,
  runBounded,
} from '@wdio/native-utils';

const log = createLogger('electron-service', 'service');

import type { Options } from '@wdio/types';
import { remote } from 'webdriverio';
import ElectronLaunchService from './launcher.js';
import ElectronWorkerService from './service.js';

const activeLaunchers = new WeakMap<WebdriverIO.Browser, ElectronLaunchService>();
const activeServices = new WeakMap<WebdriverIO.Browser, ElectronWorkerService>();

/**
 * onComplete stops a browser-mode dev server (no-op in native mode, where WDIO manages chromedriver),
 * bounded because a function-form devServer's user-supplied close() can hang.
 */
function boundedOnComplete(launcher: ElectronLaunchService, context: string): Promise<unknown> {
  return runBounded(
    () => launcher.onComplete(),
    DEFAULT_TEARDOWN_TIMEOUT_MS,
    () => log.warn(`launcher.onComplete() timed out during ${context}`),
  );
}

function failStartup(launcher: ElectronLaunchService, error: unknown): Promise<never> {
  const writer = getLogWriter('electron-service');
  return failStartupShared(
    error,
    'Electron standalone',
    () => writer.close(),
    () => boundedOnComplete(launcher, 'startup cleanup'),
  );
}

/**
 * Best-effort, time-bounded session deletion: the driver socket may already be gone (so a failure is
 * usually harmless), and the timeout keeps a stall from blocking the rest of teardown.
 */
async function deleteSessionBounded(browser: WebdriverIO.Browser, context: string): Promise<void> {
  if (!browser.sessionId) {
    return;
  }
  try {
    await runBounded(
      () => browser.deleteSession(),
      DEFAULT_TEARDOWN_TIMEOUT_MS,
      () => log.warn(`deleteSession timed out during ${context}`),
    );
  } catch (e) {
    if (isBenignTeardownError(e)) {
      log.debug(`Ignoring benign teardown error during deleteSession (${context}): ${(e as Error).message}`);
    } else {
      log.warn(`Failed to delete session during ${context}: ${(e as Error).message}`);
    }
  }
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

  // onPrepare & onWorkerStart expect an array or multiremote format, so wrap as array
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
    await deleteSessionBounded(browser, 'service.before cleanup');
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
    // WDIO's standalone remote() never runs the worker after/afterSession hooks, so cleanup() drives
    // them manually - else mock state leaks between sequential standalone sessions.
    const service = activeServices.get(browser);
    // after/afterSession args unavailable here so we cast to no-arg shape
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

    await deleteSessionBounded(browser, 'cleanup');

    // Best-effort so a failing stop can't strand the log writer & map cleanup that follow.
    await boundedOnComplete(launcher, 'cleanup').catch((e: Error) =>
      log.warn(`launcher.onComplete() failed during cleanup: ${e.message}`),
    );

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
