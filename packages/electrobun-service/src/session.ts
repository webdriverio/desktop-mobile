// Standalone (`remote()`) session helpers for `@wdio/electrobun-service`.

import type {
  ElectrobunCapabilities,
  ElectrobunServiceGlobalOptions,
  ElectrobunServiceOptions,
} from '@wdio/native-types';
import {
  boundedOnComplete,
  createLogger,
  DEFAULT_TEARDOWN_TIMEOUT_MS,
  errorMessage,
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

function failStartup(launcher: ElectrobunLaunchService, error: unknown): Promise<never> {
  return failStartupShared(error, 'Electrobun standalone', () =>
    boundedOnComplete(launcher, 'startup cleanup', log, { rethrow: true }),
  );
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
  }).catch((error: unknown) => {
    log.error(`Failed to create remote session: ${errorMessage(error)}`);
    return failStartup(launcher, error);
  });

  activeLaunchers.set(browser, launcher);

  const serviceOptions = mergeServiceOptions(globalOptions, capability[CUSTOM_CAPABILITY_NAME]);
  const service = new ElectrobunWorkerService(serviceOptions, capability);
  try {
    await service.before(capability, [], browser);
  } catch (error) {
    // after() reaps the Linux app, which the DELETE needs to complete.
    await runBounded(
      () => service.after(),
      DEFAULT_TEARDOWN_TIMEOUT_MS,
      () => log.warn('service.after() timed out during startup cleanup'),
    ).catch((e: unknown) => log.warn(`service.after() failed during startup cleanup: ${errorMessage(e)}`));
    await safeDeleteSession(browser, 'service.before cleanup', log, { timeoutMs: DEFAULT_TEARDOWN_TIMEOUT_MS });
    activeLaunchers.delete(browser);
    return failStartup(launcher, error);
  }
  activeServices.set(browser, service);

  log.debug('Electrobun standalone session initialised');
  return browser;
}

export async function cleanup(browser: WebdriverIO.Browser): Promise<void> {
  log.debug('Cleaning up Electrobun standalone session…');

  const launcher = activeLaunchers.get(browser);
  if (!launcher) {
    log.warn('No launcher found for this browser instance');
    return;
  }

  // after() covers afterSession()'s teardown too.
  const service = activeServices.get(browser);
  try {
    await runBounded(
      async () => service?.after(),
      DEFAULT_TEARDOWN_TIMEOUT_MS,
      () => log.warn('service.after() timed out during cleanup'),
    );
  } catch (e) {
    log.warn(`service.after() failed during cleanup: ${errorMessage(e)}`);
  } finally {
    activeServices.delete(browser);
  }

  await safeDeleteSession(browser, 'cleanup', log);

  await boundedOnComplete(launcher, 'cleanup', log);
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
