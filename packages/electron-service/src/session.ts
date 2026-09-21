import { getLogWriter } from '@wdio/native-core';
import type {
  ElectronServiceCapabilities,
  ElectronServiceGlobalOptions,
  ElectronServiceOptions,
  ElectronStandaloneCapability,
} from '@wdio/native-types';
import { createLogger, DEFAULT_TEARDOWN_TIMEOUT_MS, isBenignTeardownError, runBounded } from '@wdio/native-utils';

const log = createLogger('electron-service', 'service');

import type { Options } from '@wdio/types';
import { remote } from 'webdriverio';
import ElectronLaunchService from './launcher.js';
import ElectronWorkerService from './service.js';

// Store launcher instances for cleanup
const activeLaunchers = new WeakMap<WebdriverIO.Browser, ElectronLaunchService>();
// Paired with activeLaunchers so cleanup() can drive the worker-service teardown
// (mock store + puppeteer session cache) that WDIO's standalone path never
// invokes itself. Without this, mock state leaks between sequential sessions
// in the same process.
const activeServices = new WeakMap<WebdriverIO.Browser, ElectronWorkerService>();

/**
 * Best-effort teardown on a failed standalone startup, then rethrow. Closes the log writer and runs
 * launcher.onComplete() — which stops a browser-mode dev server and is a no-op in native mode where
 * WDIO owns chromedriver. A launcher-teardown failure joins the original in an AggregateError rather
 * than masking it; onComplete is bounded because a function-form devServer's close() is user-supplied and can hang.
 */
async function failStartup(launcher: ElectronLaunchService, error: unknown): Promise<never> {
  const writer = getLogWriter('electron-service');
  await writer.close().catch((e: Error) => log.warn(`Failed to close log writer: ${e.message}`));
  try {
    await runBounded(
      () => launcher.onComplete(),
      DEFAULT_TEARDOWN_TIMEOUT_MS,
      () => log.warn('launcher.onComplete() timed out during startup cleanup'),
    );
  } catch (cleanupError) {
    throw new AggregateError([error, cleanupError], 'Electron standalone startup and launcher cleanup failed', {
      cause: error,
    });
  }
  throw error;
}

/**
 * Best-effort deletion of the session during teardown. The driver socket may already be gone by
 * then, so a failure here is usually harmless, and the call is time-bounded so a stall can't block
 * the rest of teardown.
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
 * Initialize Electron service in standalone mode
 */
export async function init(
  capabilities: ElectronServiceCapabilities,
  globalOptions?: ElectronServiceGlobalOptions,
): Promise<WebdriverIO.Browser> {
  log.debug('Initializing Electron service in standalone mode...');

  // Unwrap array if needed
  const capability = Array.isArray(capabilities) ? capabilities[0] : capabilities;

  // Initialize standalone log writer if logging is enabled
  const serviceOptions = (capability as Record<string, unknown>)['wdio:electronServiceOptions'] as
    | ElectronServiceOptions
    | undefined;
  if (serviceOptions?.captureMainProcessLogs || serviceOptions?.captureRendererLogs) {
    if (serviceOptions.logDir) {
      // Use explicit logDir if provided
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

  // onPrepare expects array or multiremote format, so wrap as array
  await launcher.onPrepare(testRunnerOpts, [capability] as ElectronServiceCapabilities);

  // onWorkerStart also expects array format for consistency
  await launcher.onWorkerStart('', [capability] as WebdriverIO.Capabilities);

  log.debug('Session capabilities:', JSON.stringify(capability, null, 2));

  const service = new ElectronWorkerService(globalOptions, capability);

  // initialise session
  const browser = await remote({
    capabilities: capability,
  }).catch((error: Error) => {
    log.error(`Failed to create remote session: ${error.message}`);
    return failStartup(launcher, error);
  });

  // Store launcher for cleanup
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
    // Drive the worker-service teardown that standalone init() set up via
    // service.before(): after() stops log capture / clears puppeteer sessions,
    // afterSession() restores mocks and clears the process-wide mock store.
    // Both calls are wrapped so a failure doesn't skip the log writer + map
    // cleanup that follow.
    const service = activeServices.get(browser);
    // after()/afterSession() take WDIO hook args we don't have at the
    // standalone cleanup site (no config, no specs). Cast to a no-arg shape —
    // Electron's after() takes none and afterSession() ignores its params.
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

    // Stop a browser-mode dev server (no-op in native mode). Bounded & best-effort
    // so a hanging/failing stop can't strand the log writer & map cleanup that follow.
    try {
      await runBounded(
        () => launcher.onComplete(),
        DEFAULT_TEARDOWN_TIMEOUT_MS,
        () => log.warn('launcher.onComplete() timed out during cleanup'),
      );
    } catch (e) {
      log.warn(`launcher.onComplete() failed during cleanup: ${(e as Error).message}`);
    }

    // Close standalone log writer. The map delete is in a finally so a
    // writer.close() throw can't strand the launcher entry — a cleanup()
    // retry would then re-drive teardown against an already-cleaned session.
    const writer = getLogWriter('electron-service');
    try {
      await writer.close();
    } finally {
      activeLaunchers.delete(browser);
    }
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
