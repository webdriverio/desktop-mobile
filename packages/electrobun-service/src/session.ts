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
import { createLogger, DEFAULT_TEARDOWN_TIMEOUT_MS, isBenignTeardownError, runBounded } from '@wdio/native-utils';
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
 * Rethrow a startup failure after best-effort launcher teardown (onComplete reaps spawned
 * apps/drivers). A teardown failure joins the original in an AggregateError rather than masking it.
 * onComplete is bounded because a browser-mode devServer's close() is user-supplied and can hang.
 */
async function failStartup(launcher: ElectrobunLaunchService, error: unknown): Promise<never> {
  try {
    await runBounded(
      () => launcher.onComplete(),
      DEFAULT_TEARDOWN_TIMEOUT_MS,
      () => log.warn('launcher.onComplete() timed out during startup cleanup'),
    );
  } catch (cleanupError) {
    throw new AggregateError([error, cleanupError], 'Electrobun standalone startup and launcher cleanup failed', {
      cause: error,
    });
  }
  throw error;
}

/**
 * Close the WebDriver session, bounded + benign-swallowing: during teardown the driver socket may
 * already be gone (a benign "session not found" / socket-closed), and a stalled deleteSession must
 * not block the rest of teardown.
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

  // Same global<capability precedence the testrunner path uses — otherwise
  // service-level options passed to init() (e.g. cdpConnectionTimeout) are
  // silently dropped on the worker side.
  const serviceOptions = mergeServiceOptions(globalOptions, capability[CUSTOM_CAPABILITY_NAME]);
  const service = new ElectrobunWorkerService(serviceOptions, capability);
  try {
    await service.before(capability, [], browser);
  } catch (error) {
    await deleteSessionBounded(browser, 'service.before cleanup');
    activeLaunchers.delete(browser);
    return failStartup(launcher, error);
  }
  activeServices.set(browser, service);

  log.debug('Electrobun standalone session initialised');
  return browser;
}

/**
 * Clean up a standalone Electrobun session created by {@link init}. A browser
 * not created by init() is left untouched (warn + no-op) — its WebDriver
 * session belongs to whoever opened it.
 */
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

  await deleteSessionBounded(browser, 'cleanup');

  try {
    await runBounded(
      () => launcher.onComplete(),
      DEFAULT_TEARDOWN_TIMEOUT_MS,
      () => log.warn('launcher.onComplete() timed out during cleanup'),
    );
  } catch (e) {
    log.warn(`launcher.onComplete() failed during cleanup: ${(e as Error).message}`);
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
