// Standalone (`remote()`) session helpers for @wdio/react-native-service.
//
// Mirrors the electrobun/dioxus session API shape (createCapabilities / init / cleanup).
// WDIO's `remote()` runs only worker-level hooks, so init() manually drives the
// launcher's onPrepare first so capabilities are mutated (automationName/app set)
// before the Appium session opens.

import { createLogger } from '@wdio/native-utils';
import type { Options } from '@wdio/types';
import { remote } from 'webdriverio';

import { CUSTOM_CAPABILITY_NAME, SERVICE_NAME } from './constants.js';
import ReactNativeLaunchService from './launcher.js';
import ReactNativeWorkerService from './service.js';
import type { ReactNativeCapabilities, ReactNativeServiceGlobalOptions } from './types.js';

const log = createLogger(SERVICE_NAME, 'session');

const activeLaunchers = new WeakMap<WebdriverIO.Browser, ReactNativeLaunchService>();
const activeServices = new WeakMap<WebdriverIO.Browser, ReactNativeWorkerService>();

/**
 * Create a React Native standalone session.
 *
 * Drives launcher.onPrepare (capability mutation) then opens the Appium session
 * and installs `browser.reactNative.*`. Appium itself is expected to be running;
 * this service does not spawn it.
 */
export async function init(
  capabilities: ReactNativeCapabilities,
  globalOptions?: ReactNativeServiceGlobalOptions,
): Promise<WebdriverIO.Browser> {
  log.debug('Initializing React Native service in standalone mode…');

  const capability = Array.isArray(capabilities) ? capabilities[0] : capabilities;
  const testRunnerOpts = { capabilities: [] } as unknown as Options.Testrunner;
  const launcher = new ReactNativeLaunchService(globalOptions ?? {}, capability, testRunnerOpts);

  await launcher.onPrepare(testRunnerOpts, [capability]);

  const browser = await remote({
    capabilities: capability as WebdriverIO.Capabilities,
  }).catch(async (error: Error) => {
    log.error(`Failed to create remote session: ${error.message}`);
    // RN launcher has no driver processes to stop on completion.
    throw error;
  });

  activeLaunchers.set(browser, launcher);

  // Pass globalOptions raw — the service constructor merges the capability options itself
  // (avoids merging capability[CUSTOM_CAPABILITY_NAME] twice).
  const service = new ReactNativeWorkerService(globalOptions ?? {}, capability);
  try {
    await service.before(capability, [], browser);
  } catch (error) {
    await browser
      .deleteSession()
      .catch((e: Error) => log.warn(`deleteSession failed during service.before cleanup: ${e.message}`));
    activeLaunchers.delete(browser);
    throw error;
  }
  activeServices.set(browser, service);

  log.debug('React Native standalone session initialised');
  return browser;
}

/**
 * Clean up a standalone React Native session created by {@link init}.
 * A browser not created by init() is left untouched (warn + no-op).
 */
export async function cleanup(browser: WebdriverIO.Browser): Promise<void> {
  log.debug('Cleaning up React Native standalone session…');

  const launcher = activeLaunchers.get(browser);
  if (!launcher) {
    log.warn('No launcher found for this browser instance');
    return;
  }

  const service = activeServices.get(browser);
  try {
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

  activeLaunchers.delete(browser);
  log.debug('React Native standalone session cleaned up');
}

/**
 * Build a minimal ReactNativeCapabilities object for standalone use.
 *
 * @param options - service options; `platform` or a platformName cap is required.
 */
export function createReactNativeCapabilities(
  platformName: 'Android' | 'iOS',
  serviceOptions?: ReactNativeCapabilities['wdio:reactNativeServiceOptions'],
): ReactNativeCapabilities {
  return {
    platformName,
    [CUSTOM_CAPABILITY_NAME]: serviceOptions,
  } as ReactNativeCapabilities;
}
