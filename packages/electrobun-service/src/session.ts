// Standalone (`remote()`) session helpers for `@wdio/electrobun-service`.
//
// WDIO's `remote()` runs only worker hooks, so init() manually drives the launcher's onPrepare &
// onWorkerStart to spawn the app and pin its CDP endpoint before opening the session.

import type {
  ElectrobunCapabilities,
  ElectrobunServiceGlobalOptions,
  ElectrobunServiceOptions,
} from '@wdio/native-types';
import {
  createLogger,
  DEFAULT_TEARDOWN_TIMEOUT_MS,
  failStartup as failStartupShared,
  runBounded,
  safeDeleteSession,
} from '@wdio/native-utils';
import type { Options } from '@wdio/types';
import { remote } from 'webdriverio';

import { CUSTOM_CAPABILITY_NAME } from './constants.js';
import ElectrobunLaunchService from './launcher.js';
import ElectrobunWorkerService from './service.js';
import { mergeServiceOptions } from './serviceConfig.js';

const log = createLogger('electrobun-service', 'session');

const activeLaunchers = new WeakMap<WebdriverIO.Browser, ElectrobunLaunchService>();
const activeServices = new WeakMap<WebdriverIO.Browser, ElectrobunWorkerService>();

/**
 * onComplete stops a browser-mode dev server (no-op in native mode, where WDIO manages chromedriver),
 * bounded because a function-form devServer's user-supplied close() can hang.
 */
function boundedOnComplete(launcher: ElectrobunLaunchService, context: string): Promise<unknown> {
  return runBounded(
    () => launcher.onComplete(),
    DEFAULT_TEARDOWN_TIMEOUT_MS,
    () => log.warn(`launcher.onComplete() timed out during ${context}`),
  );
}

function failStartup(launcher: ElectrobunLaunchService, error: unknown): Promise<never> {
  return failStartupShared(error, 'Electrobun standalone', () => boundedOnComplete(launcher, 'startup cleanup'));
}

export async function init(
  capabilities: ElectrobunCapabilities,
  globalOptions?: ElectrobunServiceGlobalOptions,
): Promise<WebdriverIO.Browser> {
  log.debug('Initializing Electrobun service in standalone mode…');

  const capability = Array.isArray(capabilities) ? capabilities[0] : capabilities;
  const testRunnerOpts = { capabilities: [] } as unknown as Options.Testrunner;
  const launcher = new ElectrobunLaunchService(globalOptions ?? {}, capability, testRunnerOpts);

  // onWorkerStart spawns the app before awaiting the CDP endpoint (or spawns the WebKitGTK driver),
  // so a failure across this pair can leave a process to reap.
  try {
    await launcher.onPrepare(testRunnerOpts, [capability]);
    await launcher.onWorkerStart('', [capability]);
  } catch (error) {
    return failStartup(launcher, error);
  }

  const browser = await remote({
    capabilities: capability as WebdriverIO.Capabilities,
  }).catch((error: Error) => {
    log.error(`Failed to create remote session: ${error.message}`);
    return failStartup(launcher, error);
  });

  activeLaunchers.set(browser, launcher);

  // Merge with capability-over-global precedence, else service-level options passed to init() are
  // silently dropped on the worker side.
  const serviceOptions = mergeServiceOptions(globalOptions, capability[CUSTOM_CAPABILITY_NAME]);
  const service = new ElectrobunWorkerService(serviceOptions, capability);
  try {
    await service.before(capability, [], browser);
  } catch (error) {
    await safeDeleteSession(browser, 'service.before cleanup', log);
    activeLaunchers.delete(browser);
    return failStartup(launcher, error);
  }
  activeServices.set(browser, service);

  log.debug('Electrobun standalone session initialised');
  return browser;
}

/**
 * Clean up a standalone Electrobun session created by {@link init}.
 */
export async function cleanup(browser: WebdriverIO.Browser): Promise<void> {
  log.debug('Cleaning up Electrobun standalone session…');

  const launcher = activeLaunchers.get(browser);
  if (!launcher) {
    log.warn('No launcher found for this browser instance');
    return;
  }

  // WDIO's standalone remote() never runs the worker after/afterSession hooks, so cleanup() runs
  // after() manually - else bridge connections leak between sequential standalone sessions.
  const service = activeServices.get(browser);
  try {
    await service?.after();
  } catch (e) {
    log.warn(`service.after() failed during cleanup: ${(e as Error).message}`);
  } finally {
    activeServices.delete(browser);
  }

  await safeDeleteSession(browser, 'cleanup', log);

  await boundedOnComplete(launcher, 'cleanup').catch((e: Error) =>
    log.warn(`launcher.onComplete() failed during cleanup: ${e.message}`),
  );
  activeLaunchers.delete(browser);
  log.debug('Electrobun standalone session cleaned up');
}

/** Build a minimal ElectrobunCapabilities object for standalone use. */
export function createElectrobunCapabilities(options: ElectrobunServiceOptions): ElectrobunCapabilities {
  if (options.mode !== 'browser' && !options.appBinaryPath) {
    throw new Error('appBinaryPath is required for native-mode Electrobun standalone sessions');
  }

  return {
    browserName: 'electrobun',
    [CUSTOM_CAPABILITY_NAME]: { ...options },
  };
}
