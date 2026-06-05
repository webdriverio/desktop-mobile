import type { ReactNativeServiceAPI } from '@wdio/native-types';
import { createLogger } from '@wdio/native-utils';

import {
  clearAllMocks,
  isMockFunction as isMockFunctionUtil,
  resetAllMocks,
  restoreAllMocks,
} from './commands/allMocks.js';
import { executeScript } from './commands/execute.js';
import { listWindows, switchWindow } from './commands/switchContext.js';
import { triggerDeeplink } from './commands/triggerDeeplink.js';
import { CUSTOM_CAPABILITY_NAME, DEFAULT_METRO_HOST, DEFAULT_METRO_PORT, SERVICE_NAME } from './constants.js';
import { MetroBridge } from './metroBridge.js';
import { createMock } from './mock.js';
import { ReactNativeMockStore } from './mockStore.js';
import { getServiceOptionsFromCapability, mergeServiceOptions } from './serviceConfig.js';
import type { ReactNativeCapabilities, ReactNativeServiceGlobalOptions } from './types.js';

const log = createLogger(SERVICE_NAME, 'service');

export default class ReactNativeWorkerService {
  private options: ReactNativeServiceGlobalOptions;
  private metroBridge: MetroBridge | undefined;
  private mockStore: ReactNativeMockStore | undefined;

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

    const bridge = new MetroBridge({ platform, host, port });
    const store = new ReactNativeMockStore();
    this.metroBridge = bridge;
    this.mockStore = store;

    try {
      await bridge.connect();
      log.info(`Connected to Hermes inspector at ${host}:${port}`);
    } catch (error) {
      log.warn(
        `Could not connect to Hermes inspector (${(error as Error).message}). ` +
          'execute/mock will not be available — ensure Metro is running and the app is foregrounded.',
      );
    }

    const api: ReactNativeServiceAPI = {
      execute: async (script, ...args) => {
        if (!bridge.connected) {
          throw new Error(
            'browser.reactNative.execute: Hermes inspector is not connected. ' +
              'Ensure Metro is running and the app is in the foreground.',
          );
        }
        return executeScript(bridge.bridge, script as unknown as string, ...(args as unknown[]));
      },

      mock: async (target: string) => {
        if (!bridge.connected) {
          throw new Error(
            'browser.reactNative.mock: Hermes inspector is not connected. ' +
              'Ensure Metro is running and the app is in the foreground.',
          );
        }
        return createMock(target, bridge.bridge, store);
      },

      isMockFunction: (targetOrFn: unknown) => isMockFunctionUtil(targetOrFn, store),

      clearAllMocks: (targetPrefix?: string) => clearAllMocks(store, targetPrefix),
      resetAllMocks: (targetPrefix?: string) => resetAllMocks(store, targetPrefix),
      restoreAllMocks: (targetPrefix?: string) => restoreAllMocks(store, targetPrefix),

      triggerDeeplink: (url: string) => triggerDeeplink(browser, url),

      switchWindow: (context: string) => switchWindow(browser, context),
      listWindows: () => listWindows(browser),

      emitEvent: async <T = unknown>(event: string, payload?: T) => {
        if (!bridge.connected) {
          throw new Error('browser.reactNative.emitEvent: Hermes inspector is not connected.');
        }
        await executeScript(
          bridge.bridge,
          `DeviceEventEmitter.emit(${JSON.stringify(event)}, ${JSON.stringify(payload ?? null)})`,
        );
      },
    };

    (browser as WebdriverIO.Browser & { reactNative?: ReactNativeServiceAPI }).reactNative = api;
    log.debug('browser.reactNative API installed');
  }

  async beforeTest(): Promise<void> {
    if (!this.mockStore || !this.metroBridge?.connected) {
      return;
    }
    const store = this.mockStore;
    if (this.options.clearMocks) {
      await clearAllMocks(store, this.options.clearMocksPrefix);
    }
    if (this.options.resetMocks) {
      await resetAllMocks(store, this.options.resetMocksPrefix);
    }
    if (this.options.restoreMocks) {
      await restoreAllMocks(store, this.options.restoreMocksPrefix);
    }
  }

  async after(): Promise<void> {
    this.mockStore?.clear();
    await this.metroBridge?.close();
    this.metroBridge = undefined;
    this.mockStore = undefined;
  }

  async afterSession(): Promise<void> {
    await this.after();
  }
}
