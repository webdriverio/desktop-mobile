import type { ReactNativeServiceAPI } from '@wdio/native-types';
import { createLogger } from '@wdio/native-utils';

import {
  clearAllMocks,
  isMockFunction as isMockFunctionUtil,
  resetAllMocks,
  restoreAllMocks,
} from './commands/allMocks.js';
import { emitEvent } from './commands/emitEvent.js';
import { executeScript } from './commands/execute.js';
import { listContexts, switchContext } from './commands/switchContext.js';
import { triggerDeeplink } from './commands/triggerDeeplink.js';
import {
  CUSTOM_CAPABILITY_NAME,
  DEFAULT_METRO_HOST,
  DEFAULT_METRO_PORT,
  HERMES_CONNECT_INTERVAL_MS,
  HERMES_CONNECT_RETRIES,
  SERVICE_NAME,
} from './constants.js';
import { collectDeviceLogs, forwardDeviceLogs, startJsLogForwarding } from './logCapture.js';
import { MetroBridge } from './metroBridge.js';
import { createMock, createMockAll } from './mock.js';
import { ReactNativeMockStore } from './mockStore.js';
import { getServiceOptionsFromCapability, mergeServiceOptions } from './serviceConfig.js';
import type { ReactNativeCapabilities, ReactNativeServiceGlobalOptions } from './types.js';

const log = createLogger(SERVICE_NAME, 'service');

export default class ReactNativeWorkerService {
  private options: ReactNativeServiceGlobalOptions;
  private metroBridge: MetroBridge | undefined;
  private mockStore: ReactNativeMockStore | undefined;
  private stopJsLogs: (() => void) | undefined;
  private platform: 'android' | 'ios' | undefined;
  private browser: WebdriverIO.Browser | undefined;

  constructor(options: ReactNativeServiceGlobalOptions, capabilities: ReactNativeCapabilities) {
    const capOptions = getServiceOptionsFromCapability(
      capabilities as { [CUSTOM_CAPABILITY_NAME]?: ReactNativeCapabilities[typeof CUSTOM_CAPABILITY_NAME] },
    );
    this.options = mergeServiceOptions(options, capOptions);
    log.debug('ReactNativeWorkerService initialised');
  }

  async before(capabilities: ReactNativeCapabilities, _specs: string[], browser: WebdriverIO.Browser): Promise<void> {
    // this.options already has cap options merged from the constructor; read platform
    // directly from the capability so it's always fresh (not re-merged from this.options).
    // Normalise to lowercase for internal routing — the option and platformName both accept
    // title-case per the Appium/W3C convention; MetroBridge expects lowercase.
    const platform = (
      this.options.platform ?? (capabilities as { platformName?: string }).platformName
    )?.toLowerCase() as 'android' | 'ios' | undefined;

    const host = this.options.metroHost ?? DEFAULT_METRO_HOST;
    const port = this.options.metroPort ?? DEFAULT_METRO_PORT;

    const bridge = new MetroBridge({
      platform,
      host,
      port,
      // Wait out Hermes' post-launch registration lag (see HERMES_CONNECT_* docs) — the
      // CdpBridge default budget gives up before the inspector target appears.
      connectionRetryCount: HERMES_CONNECT_RETRIES,
      waitInterval: HERMES_CONNECT_INTERVAL_MS,
    });
    const store = new ReactNativeMockStore();
    this.metroBridge = bridge;
    this.mockStore = store;

    this.platform = platform;
    this.browser = browser;

    // Best-effort warm-up so JS log forwarding starts capturing from launch. Non-fatal:
    // the inspector target often isn't registered yet at `before` time, so the commands
    // below lazily (re)connect on first use via ensureHermes().
    try {
      await bridge.connect();
      log.info(`Connected to Hermes inspector at ${host}:${port}`);
      // Forward JS console.* (Runtime.consoleAPICalled) — the "frontend" channel, gated on
      // captureFrontendLogs (default off) and filtered by frontendLogLevel. Device logcat/syslog
      // is the separate "backend" channel (captureBackendLogs), forwarded in afterTest below.
      if (this.options.captureFrontendLogs) {
        this.stopJsLogs = await startJsLogForwarding(bridge.bridge, this.options.frontendLogLevel ?? 'info');
      }
    } catch (error) {
      log.warn(
        `Hermes inspector not ready at ${host}:${port} yet (${(error as Error).message}); ` +
          'will connect on first execute/mock.',
      );
    }

    // Connect on demand: the eager warm-up above races Hermes' registration, so the first
    // execute/mock/emitEvent may be the point at which the target finally exists. Retries
    // via the bridge's discovery budget; throws a friendly error only if it still can't.
    const ensureHermes = async (command: string): Promise<void> => {
      if (bridge.connected) {
        return;
      }
      try {
        await bridge.connect();
      } catch (error) {
        throw new Error(
          `browser.reactNative.${command}: Hermes inspector is not connected ` +
            `(${(error as Error).message}). Ensure Metro is running and the app is in the foreground.`,
        );
      }
      if (this.options.captureFrontendLogs) {
        this.stopJsLogs?.();
        this.stopJsLogs = await startJsLogForwarding(bridge.bridge, this.options.frontendLogLevel ?? 'info');
      }
      // Rewire existing mocks to the new bridge — best-effort per entry so a failed
      // reinstall on one target (e.g. the module no longer exists after a bundle reload)
      // doesn't leave every other mock broken or mask the connection-error path above.
      for (const [target] of store.getMocks()) {
        try {
          await createMock(target, bridge.bridge, store);
        } catch (error) {
          log.warn(
            `ensureHermes: failed to rewire mock '${target}' after reconnect — it will throw on next use: ${(error as Error).message}`,
          );
        }
      }
    };

    const api: ReactNativeServiceAPI = {
      execute: async (script, ...args) => {
        await ensureHermes('execute');
        return executeScript(bridge.bridge, script as unknown as string, ...(args as unknown[]));
      },

      mock: async (target: string) => {
        await ensureHermes('mock');
        return createMock(target, bridge.bridge, store);
      },

      mockAll: async (target: string) => {
        await ensureHermes('mockAll');
        return createMockAll(target, bridge.bridge, store);
      },

      // Runtime is a single boolean check; the overloaded type (value→type-guard,
      // path→boolean) is a compile-time view callers opt into, hence the cast.
      isMockFunction: ((targetOrFn: unknown) =>
        isMockFunctionUtil(targetOrFn, store)) as ReactNativeServiceAPI['isMockFunction'],

      // Guard on an empty store FIRST: a no-op bulk sweep (e.g. a beforeEach safety clear when
      // no mocks were created) must return instantly and must not require a live bridge —
      // otherwise ensureHermes blocks on the connect-retry budget (~60s) and throws "Hermes
      // inspector is not connected" when the app/bridge is down. With mocks present, ensureHermes
      // first (like mock/execute): each entry's mockClear/Reset/Restore drives a native CDP op,
      // so a dropped bridge must be re-attached (and mocks rewired) or the op would only warn.
      clearAllMocks: async (targetPrefix?: string) => {
        if (store.getMocks().length === 0) {
          return;
        }
        await ensureHermes('clearAllMocks');
        return clearAllMocks(store, targetPrefix);
      },
      resetAllMocks: async (targetPrefix?: string) => {
        if (store.getMocks().length === 0) {
          return;
        }
        await ensureHermes('resetAllMocks');
        return resetAllMocks(store, targetPrefix);
      },
      restoreAllMocks: async (targetPrefix?: string) => {
        if (store.getMocks().length === 0) {
          return;
        }
        await ensureHermes('restoreAllMocks');
        return restoreAllMocks(store, targetPrefix);
      },

      triggerDeeplink: (url: string) => triggerDeeplink(browser, url),

      switchContext: (context: string) => switchContext(browser, context),
      listContexts: () => listContexts(browser),

      emitEvent: async <T = unknown>(event: string, payload?: T) => {
        await ensureHermes('emitEvent');
        await emitEvent(bridge.bridge, event, payload);
      },
    };

    (browser as WebdriverIO.Browser & { reactNative?: ReactNativeServiceAPI }).reactNative = api;
    log.debug('browser.reactNative API installed');
  }

  async beforeTest(): Promise<void> {
    if (!this.mockStore || !this.metroBridge?.connected) {
      if (this.mockStore && (this.options.clearMocks || this.options.resetMocks || this.options.restoreMocks)) {
        log.warn(
          'beforeTest: Hermes bridge is not connected — clearMocks/resetMocks/restoreMocks skipped. ' +
            'Mock state from the previous test may bleed into this one if the app crashed or was backgrounded.',
        );
      }
      return;
    }
    const store = this.mockStore;
    // resetMocks already clears call history (mockReset → mockClear), so a separate clear
    // pass is only needed when it targets mocks reset won't touch — i.e. a different prefix.
    const clearRedundant = this.options.resetMocks && this.options.clearMocksPrefix === this.options.resetMocksPrefix;
    if (this.options.clearMocks && !clearRedundant) {
      await clearAllMocks(store, this.options.clearMocksPrefix);
    }
    if (this.options.resetMocks) {
      await resetAllMocks(store, this.options.resetMocksPrefix);
    }
    if (this.options.restoreMocks) {
      await restoreAllMocks(store, this.options.restoreMocksPrefix);
    }
  }

  async afterTest(): Promise<void> {
    // Per-test native device-log forwarding (the "backend" channel): browser.getLogs drains
    // everything since the last call, so collecting here (not in after(), which fires once per
    // spec file) keeps each test's logcat/syslog lines attributed to that test. Gated on
    // captureBackendLogs (default off) and filtered by backendLogLevel.
    if (!this.browser || !this.platform || !this.options.captureBackendLogs) {
      return;
    }
    const logType = this.platform === 'android' ? 'logcat' : 'syslog';
    forwardDeviceLogs(await collectDeviceLogs(this.browser, logType), this.options.backendLogLevel ?? 'info');
  }

  async after(): Promise<void> {
    this.stopJsLogs?.();
    this.stopJsLogs = undefined;
    this.mockStore?.clear();
    await this.metroBridge?.close();
    this.metroBridge = undefined;
    this.mockStore = undefined;
    this.browser = undefined;
    this.platform = undefined;
  }

  async afterSession(): Promise<void> {
    await this.after();
  }
}
