// Standalone (`remote()`) session helpers for `@wdio/electrobun-service`.
//
// Mirrors the dioxus session API shape (createCapabilities / init / cleanup) but
// follows the CDP-attach flow (like @wdio/electron-service): WDIO's `remote()`
// only runs worker-level hooks, so init() manually drives the launcher's
// onPrepare + onWorkerStart to resolve+spawn the app and set
// `goog:chromeOptions.debuggerAddress` before opening the Chromedriver session.

import type {
  ElectrobunCapabilities,
  ElectrobunServiceGlobalOptions,
  ElectrobunServiceOptions,
} from '@wdio/native-types';
import { createLogger } from '@wdio/native-utils';
import type { Options } from '@wdio/types';
import { remote } from 'webdriverio';

import { CUSTOM_CAPABILITY_NAME } from './constants.js';
import ElectrobunLaunchService from './launcher.js';
import ElectrobunWorkerService from './service.js';

const log = createLogger('electrobun-service', 'session');

const activeLaunchers = new WeakMap<WebdriverIO.Browser, ElectrobunLaunchService>();
const activeServices = new WeakMap<WebdriverIO.Browser, ElectrobunWorkerService>();

/**
 * Initialise an Electrobun standalone session.
 *
 * Drives the launcher's onPrepare + onWorkerStart manually (WDIO's `remote()`
 * runs only worker hooks) so the app is spawned and the CEF debugger endpoint is
 * pinned onto the capability, then opens the Chromedriver session and installs
 * the `browser.electrobun.*` surface.
 */
export async function init(
  capabilities: ElectrobunCapabilities,
  globalOptions?: ElectrobunServiceGlobalOptions,
): Promise<WebdriverIO.Browser> {
  log.debug('Initializing Electrobun service in standalone mode…');

  const capability = Array.isArray(capabilities) ? capabilities[0] : capabilities;
  const testRunnerOpts = { capabilities: [] } as unknown as Options.Testrunner;
  const launcher = new ElectrobunLaunchService(globalOptions ?? {}, capability, testRunnerOpts);

  await launcher.onPrepare(testRunnerOpts, [capability]);
  await launcher.onWorkerStart('', [capability]);

  const browser = await remote({
    capabilities: capability as WebdriverIO.Capabilities,
  }).catch(async (error: Error) => {
    log.error(`Failed to create remote session: ${error.message}`);
    await launcher
      .onComplete()
      .catch((cleanupErr: Error) => log.warn(`Failed to stop app during cleanup: ${cleanupErr.message}`));
    throw error;
  });

  activeLaunchers.set(browser, launcher);

  const serviceOptions = capability[CUSTOM_CAPABILITY_NAME] ?? {};
  const service = new ElectrobunWorkerService(serviceOptions, capability);
  try {
    await service.before(capability, [], browser);
  } catch (error) {
    await browser
      .deleteSession()
      .catch((e: Error) => log.warn(`Failed to delete session during service.before cleanup: ${e.message}`));
    await launcher
      .onComplete()
      .catch((e: Error) => log.warn(`Failed to stop app during service.before cleanup: ${e.message}`));
    activeLaunchers.delete(browser);
    throw error;
  }
  activeServices.set(browser, service);

  log.debug('Electrobun standalone session initialised');
  return browser;
}

/** Clean up a standalone Electrobun session created by {@link init}. */
export async function cleanup(browser: WebdriverIO.Browser): Promise<void> {
  log.debug('Cleaning up Electrobun standalone session…');

  const launcher = activeLaunchers.get(browser);
  if (!launcher) {
    log.warn('No launcher found for this browser instance');
    return;
  }

  const service = activeServices.get(browser);
  try {
    // One call is the whole worker teardown: after() and afterSession() both
    // delegate to the same closeBridges() (the testrunner calls whichever hook
    // fires) — unlike the dioxus cleanup, where the two hooks do different work.
    await service?.after();
  } catch (e) {
    log.warn(`service.after() failed during cleanup: ${(e as Error).message}`);
  } finally {
    activeServices.delete(browser);
  }

  try {
    if (browser.sessionId) {
      await browser.deleteSession();
    }
  } catch (e) {
    log.warn(`Failed to delete session during cleanup: ${(e as Error).message}`);
  }

  try {
    await launcher.onComplete();
  } finally {
    activeLaunchers.delete(browser);
  }
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
