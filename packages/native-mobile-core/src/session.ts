// Standalone (`remote()`) session factory for Appium-driven mobile services.
//
// WDIO's `remote()` runs only worker-level hooks, so init() runs onPrepare before opening the
// session — onPrepare mutates the capabilities in place, and remote() opens with them.

import { createLogger } from '@wdio/native-utils';
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

/**
 * Rethrow a startup failure after best-effort launcher teardown. A teardown failure joins the
 * original in an AggregateError rather than masking it.
 */
async function failStartup<TCap>(launcher: MobileLauncherLike<TCap>, error: unknown): Promise<never> {
  try {
    await launcher.onComplete?.();
  } catch (cleanupError) {
    throw new AggregateError([error, cleanupError], 'Mobile standalone startup and launcher cleanup failed', {
      cause: error,
    });
  }
  throw error;
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

  async function init(
    capabilities: TCap | TCap[],
    globalOptions?: TOptions,
    connection?: AppiumServerConnection,
  ): Promise<WebdriverIO.Browser> {
    log.debug('Initializing mobile service in standalone mode…');

    const capability = (Array.isArray(capabilities) ? capabilities[0] : capabilities) as TCap | undefined;
    if (!capability) {
      throw new Error(
        'createMobileSession.init(): no capability provided — pass a capability object or a non-empty capabilities array.',
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
      await browser
        .deleteSession()
        .catch((e: Error) => log.warn(`deleteSession failed during service.before cleanup: ${e.message}`));
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

    try {
      await launcher.onComplete?.();
    } catch (e) {
      log.warn(`launcher.onComplete() failed during cleanup: ${(e as Error).message}`);
    }

    activeLaunchers.delete(browser);
    log.debug('Mobile standalone session cleaned up');
  }

  return { init, cleanup };
}
