// Standalone (`remote()`) session factory for Appium-driven mobile services.
//
// WDIO's `remote()` runs only worker-level hooks, so init() manually drives the
// launcher's onPrepare first so capabilities are mutated (automationName/app set)
// before the Appium session opens. Parameterized over the launcher + worker classes so
// each service binds its own; the active-session WeakMaps live in the factory closure.

import { createLogger } from '@wdio/native-utils';
import type { Options } from '@wdio/types';
import { remote } from 'webdriverio';

/**
 * Appium-server connection for a standalone session. In the runner path
 * `@wdio/appium-service` supplies this; standalone callers pass it here. Defaults target
 * Appium's own defaults (`localhost:4723/`) — NOT WebdriverIO's `localhost:4444`, which would
 * never reach an Appium server.
 */
export interface AppiumServerConnection {
  hostname?: string;
  port?: number;
  path?: string;
  protocol?: string;
}

/** Minimal launcher contract init() drives (the subclass extends MobileBaseLauncher). */
interface MobileLauncherLike<TCap> {
  onPrepare(config: Options.Testrunner, capabilities: TCap[] | Record<string, { capabilities: TCap }>): Promise<void>;
}

/** Minimal worker contract init()/cleanup() drive (the subclass is the worker service). */
interface MobileWorkerLike<TCap> {
  before(capability: TCap, specs: string[], browser: WebdriverIO.Browser): Promise<void>;
  after(): Promise<void>;
}

export interface MobileSessionDeps<TOptions, TCap> {
  LauncherClass: new (options: TOptions, capability: TCap, config: Options.Testrunner) => MobileLauncherLike<TCap>;
  WorkerClass: new (options: TOptions, capability: TCap) => MobileWorkerLike<TCap>;
  /** Default Appium server address; falls back to localhost:4723/. */
  defaultConnection?: AppiumServerConnection;
  /** Logger namespace (the consuming service's package short name). */
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
 * Build the standalone `init`/`cleanup` pair for a mobile service. The active-session
 * launcher/worker WeakMaps are private to the returned closure.
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
      // An empty array (or undefined) otherwise resolves to an undefined capability that
      // surfaces as a cryptic onPrepare/remote() failure deep in the launch path.
      throw new Error(
        'createMobileSession.init(): no capability provided — pass a capability object or a non-empty capabilities array.',
      );
    }
    const testRunnerOpts = { capabilities: [] } as unknown as Options.Testrunner;
    const opts = (globalOptions ?? {}) as TOptions;
    const launcher = new deps.LauncherClass(opts, capability, testRunnerOpts);

    await launcher.onPrepare(testRunnerOpts, [capability]);

    // Construct the worker BEFORE opening the session: a constructor throw here would otherwise
    // leave a live Appium session the caller never receives a browser handle for (so can't close).
    // Pass globalOptions raw — the service constructor merges the capability options itself.
    const service = new deps.WorkerClass(opts, capability);

    const browser = await remote({
      // Appium defaults; remote() otherwise targets WebdriverIO's localhost:4444, which an Appium
      // server (default localhost:4723) is never on. Callers override via `connection`.
      hostname: 'localhost',
      port: 4723,
      path: '/',
      ...deps.defaultConnection,
      ...connection,
      capabilities: capability as WebdriverIO.Capabilities,
    }).catch((error: Error) => {
      log.error(`Failed to create remote session: ${error.message}`);
      // Appium-driven launchers have no driver processes to stop on completion.
      throw error;
    });

    activeLaunchers.set(browser, launcher);

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

    activeLaunchers.delete(browser);
    log.debug('Mobile standalone session cleaned up');
  }

  return { init, cleanup };
}
