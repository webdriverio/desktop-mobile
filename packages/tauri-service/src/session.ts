import http from 'node:http';
import { closeLogWriter, getLogWriter } from '@wdio/native-core';
import {
  boundedOnComplete,
  createLogger,
  failStartup,
  PROCESS_TEARDOWN_TIMEOUT_MS,
  runBounded,
  safeDeleteSession,
} from '@wdio/native-utils';
import { remote } from 'webdriverio';
import TauriLaunchService from './launcher.js';
import TauriWorkerService from './service.js';
import type { TauriCapabilities, TauriServiceGlobalOptions } from './types.js';

const log = createLogger('tauri-service', 'service');

const activeLaunchers = new WeakMap<WebdriverIO.Browser, TauriLaunchService>();
const activeServices = new WeakMap<WebdriverIO.Browser, TauriWorkerService>();

async function checkDriverHealth(hostname: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://${hostname}:${port}/status`, (res) => {
      resolve(res.statusCode === 200);
      res.resume();
    });
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}

export async function init(
  capabilities: TauriCapabilities,
  globalOptions?: TauriServiceGlobalOptions,
): Promise<WebdriverIO.Browser> {
  log.debug('Initializing Tauri service in standalone mode...');

  const serviceOptions = capabilities['wdio:tauriServiceOptions'];
  if (serviceOptions?.captureBackendLogs || serviceOptions?.captureFrontendLogs) {
    if (serviceOptions.logDir) {
      const writer = getLogWriter('tauri-service');
      writer.initialize(serviceOptions.logDir);
      log.debug(`Log writer initialized at ${writer.getLogDir()}`);
    } else {
      log.warn('Standalone logging enabled but logDir not specified - logs will not be captured');
    }
  }

  const testRunnerOpts = globalOptions?.rootDir
    ? { rootDir: globalOptions.rootDir, capabilities: [] }
    : { capabilities: [] };
  const launcher = new TauriLaunchService(globalOptions || {}, capabilities, testRunnerOpts);

  let browser: WebdriverIO.Browser | undefined;
  try {
    await launcher.onPrepare(testRunnerOpts, [capabilities]);

    await launcher.onWorkerStart('standalone', capabilities);

    log.debug('Tauri service capabilities after onPrepare:', JSON.stringify(capabilities, null, 2));

    const hostname = (capabilities as { hostname?: string }).hostname || 'localhost';
    const port = (capabilities as { port?: number }).port;
    if (!port) {
      throw new Error(
        'Tauri driver port was not set on capabilities by onPrepare. ' +
          'This usually means the launcher failed to allocate a port.',
      );
    }

    // Create a deep clone for driver initialization so we can strip unsupported props
    const driverCapabilities = structuredClone(capabilities);

    const stripUnsupportedProps = (cap: TauriCapabilities | undefined) => {
      if (!cap || typeof cap !== 'object') {
        return;
      }
      delete (cap as { hostname?: string }).hostname;
      delete (cap as { port?: number }).port;
      delete (cap as { browserName?: string }).browserName;
    };

    if (Array.isArray(driverCapabilities)) {
      for (const cap of driverCapabilities) {
        stripUnsupportedProps(cap);
      }
    } else if (driverCapabilities && typeof driverCapabilities === 'object') {
      const maybeMultiRemote = driverCapabilities as Record<string, { capabilities?: TauriCapabilities }>;
      const entries = Object.values(maybeMultiRemote);
      const isMultiRemote = entries.every((entry) => entry && typeof entry === 'object' && 'capabilities' in entry);
      if (isMultiRemote) {
        for (const entry of entries) {
          stripUnsupportedProps(entry?.capabilities);
        }
      } else {
        stripUnsupportedProps(driverCapabilities as TauriCapabilities);
      }
    }

    log.debug(`Connection info for remote(): hostname=${hostname}, port=${port}, browserName=wry (display only)`);

    const driverHealthy = await checkDriverHealth(hostname, port);
    if (!driverHealthy) {
      log.warn('tauri-driver health check failed before session creation');
    }

    const service = new TauriWorkerService(capabilities['wdio:tauriServiceOptions'] || {}, capabilities);

    const startTimeout = serviceOptions?.startTimeout || 30000;

    log.debug(`Starting remote session with startTimeout=${startTimeout}ms`);

    browser = await remote({
      // connection info must be at top level, not in capabilities
      hostname,
      port,
      capabilities: driverCapabilities,
      // native desktop apps can be slow to start
      connectionRetryTimeout: startTimeout * 4,
      connectionRetryCount: 10,
    });

    log.debug('Remote session created successfully, initializing service...');

    await service.before(capabilities, [], browser);
    activeLaunchers.set(browser, launcher);
    activeServices.set(browser, service);

    log.debug('Tauri standalone session initialized');
    return browser;
  } catch (error) {
    const startupError =
      error instanceof Error ? error : new Error('Tauri standalone session startup failed', { cause: error });
    if (browser) {
      await safeDeleteSession(browser, 'startup cleanup', log);
    }
    return failStartup(startupError, 'Tauri standalone', () =>
      boundedOnComplete(launcher, 'startup cleanup', log, { rethrow: true, timeoutMs: PROCESS_TEARDOWN_TIMEOUT_MS }),
    );
  }
}

/**
 * Clean up Tauri service for a standalone session
 * Call this when you're done with a browser instance created via init()
 */
export async function cleanup(browser: WebdriverIO.Browser): Promise<void> {
  log.debug('Cleaning up Tauri standalone session...');

  const launcher = activeLaunchers.get(browser);
  if (launcher) {
    // WDIO's standalone remote() never runs the worker after/afterSession hooks, so mock/window state
    // would leak between sequential sessions.
    const service = activeServices.get(browser);
    // Safe without WDIO's hook args: the impls ignore them.
    const svc = service as unknown as { after?: () => Promise<void>; afterSession?: () => Promise<void> } | undefined;
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

    // onWorkerEnd stops an external provider's per-worker driver/backend (a no-op for embedded); a
    // failure here mustn't skip the onComplete teardown below.
    await runBounded(
      () => launcher.onWorkerEnd('standalone'),
      PROCESS_TEARDOWN_TIMEOUT_MS,
      () => log.warn(`launcher.onWorkerEnd() timed out after ${PROCESS_TEARDOWN_TIMEOUT_MS}ms during cleanup`),
    ).catch((e: Error) => log.warn(`launcher.onWorkerEnd() failed during cleanup: ${e.message}`));

    await boundedOnComplete(launcher, 'cleanup', log, { timeoutMs: PROCESS_TEARDOWN_TIMEOUT_MS });

    await closeLogWriter('tauri-service').catch((e: Error) =>
      log.warn(`Failed to close log writer during cleanup: ${e.message}`),
    );
    activeLaunchers.delete(browser);
    log.debug('Tauri standalone session cleaned up');
  } else {
    log.warn('No launcher found for this browser instance');
  }
}

/**
 * Create Tauri capabilities
 */
export function createTauriCapabilities(
  appBinaryPath: string,
  options: {
    appArgs?: string[];
    tauriDriverPort?: number;
    logLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
    commandTimeout?: number;
    startTimeout?: number;
    driverProvider?: 'external' | 'official' | 'crabnebula' | 'embedded';
    autoInstallTauriDriver?: boolean;
  } = {},
): TauriCapabilities {
  return {
    'tauri:options': {
      application: appBinaryPath,
      args: options.appArgs || [],
    },
    'wdio:tauriServiceOptions': {
      appBinaryPath,
      appArgs: options.appArgs || [],
      tauriDriverPort: options.tauriDriverPort,
      logLevel: options.logLevel || 'info',
      commandTimeout: options.commandTimeout || 30000,
      startTimeout: options.startTimeout || 60000,
      driverProvider: options.driverProvider,
      autoInstallTauriDriver: options.autoInstallTauriDriver,
    },
  };
}
