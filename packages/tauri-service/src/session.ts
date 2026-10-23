import http from 'node:http';
import { join } from 'node:path';
import { getLogWriter } from '@wdio/native-core';
import { boundedOnComplete, createLogger, errorMessage, failStartup, safeDeleteSession } from '@wdio/native-utils';
import { remote } from 'webdriverio';
import TauriLaunchService from './launcher.js';
import TauriWorkerService from './service.js';
import { mergeServiceOptions } from './serviceConfig.js';
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

async function driverRemoteOptions(
  capabilities: TauriCapabilities,
  startTimeout: number,
): Promise<Parameters<typeof remote>[0]> {
  const hostname = (capabilities as { hostname?: string }).hostname || 'localhost';
  const port = (capabilities as { port?: number }).port;
  if (!port) {
    throw new Error(
      'Tauri driver port was not set on capabilities by onPrepare. ' +
        'This usually means the launcher failed to allocate a port.',
    );
  }

  // remote() rejects non-W3C keys such as port and hostname; a deep clone would throw on a devServer function.
  const driverCapabilities = { ...capabilities };
  delete (driverCapabilities as { hostname?: string }).hostname;
  delete (driverCapabilities as { port?: number }).port;
  delete (driverCapabilities as { browserName?: string }).browserName;

  log.debug(`Connection info for remote(): hostname=${hostname}, port=${port}, browserName=wry (display only)`);

  const driverHealthy = await checkDriverHealth(hostname, port);
  if (!driverHealthy) {
    log.warn('tauri-driver health check failed before session creation');
  }

  log.debug(`Starting remote session with startTimeout=${startTimeout}ms`);

  return {
    hostname,
    port,
    capabilities: driverCapabilities,
    // native desktop apps can be slow to start
    connectionRetryTimeout: startTimeout * 4,
    connectionRetryCount: 10,
  };
}

// The launcher writes into these objects during onPrepare; copying them keeps the caller's capabilities intact.
function copyCapabilities(capabilities: TauriCapabilities): TauriCapabilities {
  return {
    ...capabilities,
    ...(capabilities['tauri:options'] && { 'tauri:options': { ...capabilities['tauri:options'] } }),
    ...(capabilities['wdio:tauriServiceOptions'] && {
      'wdio:tauriServiceOptions': { ...capabilities['wdio:tauriServiceOptions'] },
    }),
  };
}

// Drops connection keys WebdriverIO would reject, and copies wdio:chromedriverOptions, which it mutates in place.
function browserSessionCapabilities(capabilities: TauriCapabilities): TauriCapabilities {
  const copy: Record<string, unknown> = { ...capabilities };
  delete copy.hostname;
  delete copy.port;
  const chromedriverOptions = copy['wdio:chromedriverOptions'];
  if (chromedriverOptions && typeof chromedriverOptions === 'object') {
    copy['wdio:chromedriverOptions'] = { ...chromedriverOptions };
  }
  return copy as TauriCapabilities;
}

export async function init(
  callerCapabilities: TauriCapabilities,
  globalOptions?: TauriServiceGlobalOptions,
): Promise<WebdriverIO.Browser> {
  log.debug('Initializing Tauri service in standalone mode...');

  const capabilities = copyCapabilities(callerCapabilities);
  const serviceOptions = capabilities['wdio:tauriServiceOptions'] ?? {};
  if (serviceOptions.captureBackendLogs || serviceOptions.captureFrontendLogs) {
    if (mergeServiceOptions(globalOptions, serviceOptions).mode === 'browser') {
      log.warn('Log capture is unavailable in browser mode: there is no Tauri app process to capture logs from');
    } else if (serviceOptions.logDir) {
      const writer = getLogWriter('tauri-service');
      writer.initialize(serviceOptions.logDir);
      log.debug(`Log writer initialized at ${writer.getLogDir()}`);
    } else {
      log.info(`Standalone logging enabled without logDir - logs will be written to ${join(process.cwd(), 'logs')}`);
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

    // Browser mode has no Tauri driver: WebdriverIO starts and manages chromedriver itself.
    const remoteOptions = launcher.isBrowserMode
      ? { capabilities: browserSessionCapabilities(capabilities) }
      : await driverRemoteOptions(capabilities, serviceOptions.startTimeout || 30000);

    const service = new TauriWorkerService(globalOptions ?? {}, capabilities);

    browser = await remote(remoteOptions);

    log.debug('Remote session created successfully, initializing service...');

    await service.before(capabilities, [], browser);
    activeLaunchers.set(browser, launcher);
    activeServices.set(browser, service);

    log.debug('Tauri standalone session initialized');
    return browser;
  } catch (error) {
    if (browser) {
      await safeDeleteSession(browser, 'startup cleanup', log);
    }
    return failStartup(error, 'Tauri standalone', () =>
      boundedOnComplete(launcher, 'startup cleanup', log, { rethrow: true }),
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
    const service = activeServices.get(browser);
    const svc = service as unknown as { afterSession?: () => Promise<void> } | undefined;
    try {
      await svc?.afterSession?.();
    } catch (e) {
      log.warn(`service.afterSession() failed during cleanup: ${errorMessage(e)}`);
    } finally {
      activeServices.delete(browser);
    }

    await boundedOnComplete(launcher, 'cleanup', log);
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
