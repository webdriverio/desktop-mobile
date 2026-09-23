// Standalone (`remote()`) session factory for Appium-driven mobile services.
//
// WDIO's `remote()` runs only worker hooks, so init() runs onPrepare first - it mutates the
// capabilities in place, and remote() opens the session with them.

import {
  boundedOnComplete,
  createLogger,
  failStartup as failStartupShared,
  PROCESS_TEARDOWN_TIMEOUT_MS,
  safeDeleteSession,
} from '@wdio/native-utils';
import type { Options } from '@wdio/types';
import { remote } from 'webdriverio';

/**
 * Appium-server connection for a standalone session.
 */
export interface AppiumServerConnection {
  hostname?: string;
  port?: number;
  path?: string;
  protocol?: string;
}

interface MobileLauncherLike<TCap> {
  onPrepare(config: Options.Testrunner, capabilities: TCap[] | Record<string, { capabilities: TCap }>): Promise<void>;
  // Stop launcher-owned processes. RN-only - Flutter's launcher owns nothing to stop.
  onComplete?(): Promise<void>;
}

interface MobileWorkerLike<TCap> {
  before(capability: TCap, specs: string[], browser: WebdriverIO.Browser): Promise<void>;
  after(): Promise<void>;
}

export interface MobileSessionDeps<TOptions, TCap> {
  LauncherClass: new (options: TOptions, capability: TCap, config: Options.Testrunner) => MobileLauncherLike<TCap>;
  WorkerClass: new (options: TOptions, capability: TCap) => MobileWorkerLike<TCap>;
  defaultConnection?: AppiumServerConnection;
  logNamespace: string;
}

export interface MobileSession<TOptions, TCap> {
  init(
    capabilities: TCap | TCap[],
    globalOptions?: TOptions,
    connection?: AppiumServerConnection,
  ): Promise<WebdriverIO.Browser>;
  cleanup(browser: WebdriverIO.Browser): Promise<void>;
}

/**
 * Build the standalone session for a mobile service.
 */
export function createMobileSession<TOptions extends object, TCap extends object>(
  deps: MobileSessionDeps<TOptions, TCap>,
): MobileSession<TOptions, TCap> {
  const log = createLogger(deps.logNamespace, 'session');
  const activeLaunchers = new WeakMap<WebdriverIO.Browser, MobileLauncherLike<TCap>>();
  const activeServices = new WeakMap<WebdriverIO.Browser, MobileWorkerLike<TCap>>();

  function failStartup(launcher: MobileLauncherLike<TCap>, error: unknown): Promise<never> {
    return failStartupShared(error, 'Mobile standalone', () =>
      boundedOnComplete(launcher, 'startup cleanup', log, { rethrow: true, timeoutMs: PROCESS_TEARDOWN_TIMEOUT_MS }),
    );
  }

  async function init(
    capabilities: TCap | TCap[],
    globalOptions?: TOptions,
    connection?: AppiumServerConnection,
  ): Promise<WebdriverIO.Browser> {
    log.debug('Initializing mobile service in standalone mode…');

    const capability = (Array.isArray(capabilities) ? capabilities[0] : capabilities) as TCap | undefined;
    if (!capability) {
      throw new Error(
        'createMobileSession.init(): no capability provided - pass a capability object or a non-empty capabilities array.',
      );
    }
    const testRunnerOpts = { capabilities: [] } as unknown as Options.Testrunner;
    const opts = (globalOptions ?? {}) as TOptions;
    const launcher = new deps.LauncherClass(opts, capability, testRunnerOpts);

    await launcher.onPrepare(testRunnerOpts, [capability]);

    // Construct the worker before opening the session
    let service: MobileWorkerLike<TCap>;
    try {
      service = new deps.WorkerClass(opts, capability);
    } catch (error) {
      return failStartup(launcher, error);
    }

    const browser = await remote({
      // Overrides default (WebdriverIO's localhost:4444) with Appium defaults
      hostname: 'localhost',
      port: 4723,
      path: '/',
      ...deps.defaultConnection,
      ...connection,
      capabilities: capability as WebdriverIO.Capabilities,
    }).catch((error: Error) => {
      log.error(`Failed to create remote session: ${error.message}`);
      return failStartup(launcher, error);
    });

    activeLaunchers.set(browser, launcher);

    try {
      await service.before(capability, [], browser);
    } catch (error) {
      await safeDeleteSession(browser, 'service.before cleanup', log);
      activeLaunchers.delete(browser);
      return failStartup(launcher, error);
    }
    activeServices.set(browser, service);

    log.debug('Mobile standalone session initialised');
    return browser;
  }

  async function cleanup(browser: WebdriverIO.Browser): Promise<void> {
    log.debug('Cleaning up mobile standalone session…');

    const launcher = activeLaunchers.get(browser);
    if (!launcher) {
      log.warn('No launcher found for this browser instance');
      return;
    }

    // WDIO's standalone remote() never runs the worker after hook, so cleanup() drives it manually
    // - else mock state leaks between sequential standalone sessions.
    const service = activeServices.get(browser);
    try {
      await service?.after();
    } catch (e) {
      log.warn(`service.after() failed during cleanup: ${(e as Error).message}`);
    } finally {
      activeServices.delete(browser);
    }

    await safeDeleteSession(browser, 'cleanup', log);

    await boundedOnComplete(launcher, 'cleanup', log, { timeoutMs: PROCESS_TEARDOWN_TIMEOUT_MS });

    activeLaunchers.delete(browser);
    log.debug('Mobile standalone session cleaned up');
  }

  return { init, cleanup };
}
