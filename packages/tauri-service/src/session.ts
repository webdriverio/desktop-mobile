import http from 'node:http';
import { createLogger } from '@wdio/native-utils';
import type { Options } from '@wdio/types';
import { remote } from 'webdriverio';
import TauriLaunchService from './launcher.js';
import { closeLogWriter, getLogWriter } from './logWriter.js';
import TauriWorkerService from './service.js';
import type { TauriCapabilities, TauriServiceGlobalOptions } from './types.js';

const log = createLogger('tauri-service', 'service');

// Store launcher instances for cleanup (WeakMap for automatic GC if cleanup() not called)
const activeLaunchers = new WeakMap<WebdriverIO.Browser, TauriLaunchService>();
// Paired with activeLaunchers so cleanup() can drive the worker-service teardown
// (mock store + window state) that WDIO's standalone path never invokes itself.
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

/**
 * Initialize Tauri service in standalone mode
 */
export async function init(
  capabilities: TauriCapabilities,
  globalOptions?: TauriServiceGlobalOptions,
): Promise<WebdriverIO.Browser> {
  log.debug('Initializing Tauri service in standalone mode...');

  // Initialize standalone log writer if logging is enabled
  const serviceOptions = capabilities['wdio:tauriServiceOptions'];
  if (serviceOptions?.captureBackendLogs || serviceOptions?.captureFrontendLogs) {
    if (serviceOptions.logDir) {
      // Use explicit logDir if provided
      const writer = getLogWriter();
      console.log(`[DEBUG] Initializing log writer with logDir: ${serviceOptions.logDir}`);
      writer.initialize(serviceOptions.logDir);
      console.log(`[DEBUG] Log writer initialized. Directory: ${writer.getLogDir()}, File: ${writer.getLogFile()}`);
      log.debug(`Log writer initialized at ${writer.getLogDir()}`);
    } else {
      log.warn('Standalone logging enabled but logDir not specified - logs will not be captured');
    }
  }

  const testRunnerOpts = globalOptions?.rootDir
    ? { rootDir: globalOptions.rootDir, capabilities: [] }
    : { capabilities: [] };
  const launcher = new TauriLaunchService(globalOptions || {}, capabilities, testRunnerOpts);

  // Prepare the service
  await launcher.onPrepare(testRunnerOpts, [capabilities]);

  // Start worker session
  await launcher.onWorkerStart('standalone', capabilities);

  log.debug('Tauri service capabilities after onPrepare:', JSON.stringify(capabilities, null, 2));

  // Extract connection info from capabilities (set by launcher.onPrepare)
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

  // Verify driver is healthy before session creation
  const driverHealthy = await checkDriverHealth(hostname, port);
  if (!driverHealthy) {
    log.warn('tauri-driver health check failed before session creation');
  }

  // Create worker service
  const service = new TauriWorkerService(capabilities['wdio:tauriServiceOptions'] || {}, capabilities);

  const startTimeout = serviceOptions?.startTimeout || 30000;

  log.debug(`Starting remote session with startTimeout=${startTimeout}ms`);

  // Minimal Testrunner-shaped config used to call launcher.onComplete during
  // standalone teardown. The launcher's onComplete only reads .capabilities,
  // so the shape is intentionally bare.
  const minimalConfig = { capabilities: [] } as unknown as Options.Testrunner;

  // Initialize session - connection info must be at top level, not in capabilities
  // Use extended timeouts for native desktop apps which may take longer to start
  const browser = await remote({
    hostname,
    port,
    capabilities: driverCapabilities,
    connectionRetryTimeout: startTimeout * 4,
    connectionRetryCount: 10,
  }).catch(async (error: Error) => {
    log.error(`Failed to create remote session: ${error.message}`);
    log.error(`This may indicate tauri-driver crashed or the app failed to start`);
    // remote() failure leaves tauri-driver + msedgedriver running because the
    // caller never sees a browser and can't invoke cleanup(). Tear them down
    // here before rethrowing so the process doesn't accumulate ghosts.
    await launcher
      .onComplete(0, minimalConfig, [])
      .catch((e: Error) => log.warn(`Failed to stop tauri-driver during remote() cleanup: ${e.message}`));
    throw error;
  });

  log.debug('Remote session created successfully, initializing service...');

  // Store launcher for cleanup
  activeLaunchers.set(browser, launcher);

  // service.before() failure leaves both the open WebDriver session AND
  // tauri-driver running. Tear both down before rethrowing so the caller
  // doesn't have to.
  try {
    await service.before(capabilities, [], browser);
  } catch (error) {
    await browser
      .deleteSession()
      .catch((e: Error) => log.warn(`Failed to delete session during service.before cleanup: ${e.message}`));
    await launcher
      .onComplete(0, minimalConfig, [])
      .catch((e: Error) => log.warn(`Failed to stop tauri-driver during service.before cleanup: ${e.message}`));
    activeLaunchers.delete(browser);
    throw error;
  }
  activeServices.set(browser, service);

  log.debug('Tauri standalone session initialized');
  return browser;
}

/**
 * Clean up Tauri service for a standalone session
 * Call this when you're done with a browser instance created via init()
 */
export async function cleanup(browser: WebdriverIO.Browser): Promise<void> {
  log.debug('Cleaning up Tauri standalone session...');

  const launcher = activeLaunchers.get(browser);
  if (launcher) {
    // Drive the worker-service teardown (mock store clear, window state) that
    // standalone init() set up via service.before(). Both calls are wrapped so
    // a failure doesn't skip the launcher.onComplete that stops tauri-driver.
    const service = activeServices.get(browser);
    // after()/afterSession() take WDIO hook args we don't have at the
    // standalone cleanup site (no test config, no specs). Cast to a no-arg
    // shape — Tauri's impls ignore their params.
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

    // End worker session
    await launcher.onWorkerEnd('standalone');

    // Complete the launcher lifecycle to stop tauri-driver
    // Create minimal config object matching Options.Testrunner
    const minimalConfig: Options.Testrunner = {
      capabilities: [],
    } as Options.Testrunner;
    await launcher.onComplete(0, minimalConfig, []);

    // Close log writer
    await closeLogWriter();

    // Remove from active launchers
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

/**
 * Get Tauri service status
 */
export function getTauriServiceStatus(): {
  available: boolean;
  version?: string;
} {
  try {
    // This would be implemented to check if the service is available
    return {
      available: true,
      version: '0.0.0',
    };
  } catch {
    return {
      available: false,
    };
  }
}
