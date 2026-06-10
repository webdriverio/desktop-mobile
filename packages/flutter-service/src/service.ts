import {
  collectDeviceLogs,
  forwardDeviceLogs,
  listWindows,
  switchWindow,
  triggerDeeplink,
} from '@wdio/native-mobile-core';
import type { FlutterServiceAPI } from '@wdio/native-types';
import { createLogger } from '@wdio/native-utils';

import {
  clearAllMocks,
  isMockFunction as isMockFunctionUtil,
  resetAllMocks,
  restoreAllMocks,
} from './commands/allMocks.js';
import { executeScript } from './commands/execute.js';
import {
  CUSTOM_CAPABILITY_NAME,
  SERVICE_NAME,
  VM_SERVICE_CONNECT_INTERVAL_MS,
  VM_SERVICE_CONNECT_RETRIES,
} from './constants.js';
import { createFlutterMock } from './mock.js';
import { FlutterMockStore } from './mockStore.js';
import { getServiceOptionsFromCapability, mergeServiceOptions } from './serviceConfig.js';
import type { FlutterCapabilities, FlutterServiceGlobalOptions } from './types.js';
import { VmServiceClient } from './vmService.js';
import { discoverVmServiceUrl } from './vmServiceDiscovery.js';

const log = createLogger(SERVICE_NAME, 'service');

export default class FlutterWorkerService {
  private options: FlutterServiceGlobalOptions;
  private client: VmServiceClient | undefined;
  private store: FlutterMockStore | undefined;
  private platform: 'android' | 'ios' | undefined;
  private browser: WebdriverIO.Browser | undefined;
  private vmServiceUrl: string | undefined;

  constructor(options: FlutterServiceGlobalOptions, capabilities: FlutterCapabilities) {
    const capOptions = getServiceOptionsFromCapability(
      capabilities as { [CUSTOM_CAPABILITY_NAME]?: FlutterServiceGlobalOptions },
    );
    this.options = mergeServiceOptions(options, capOptions);
    log.debug('FlutterWorkerService initialised');
  }

  async before(capabilities: FlutterCapabilities, _specs: string[], browser: WebdriverIO.Browser): Promise<void> {
    const platform = (
      this.options.platform ?? (capabilities as { platformName?: string }).platformName
    )?.toLowerCase() as 'android' | 'ios' | undefined;
    this.platform = platform;
    this.browser = browser;
    this.store = new FlutterMockStore();
    const store = this.store;

    // Connect on demand: the Dart VM Service URL is logged a few seconds after launch, so the
    // first execute/mock is often the point at which it's discoverable. Mirrors the RN service's
    // ensureHermes lazy-(re)connect — also covers reconnect after the app is backgrounded (the
    // isolate suspends and the socket drops).
    const ensureVmService = async (command: string): Promise<VmServiceClient> => {
      if (this.client?.connected) {
        return this.client;
      }
      try {
        if (!this.vmServiceUrl) {
          this.vmServiceUrl = await discoverVmServiceUrl(browser, {
            platform,
            retries: VM_SERVICE_CONNECT_RETRIES,
            intervalMs: VM_SERVICE_CONNECT_INTERVAL_MS,
          });
        }
        const client = new VmServiceClient(this.vmServiceUrl);
        await client.connect();
        this.client = client;
        // Re-wire existing mocks onto the new connection (reconnect path) while preserving
        // the outer mock's call history.
        for (const [target] of store.getMocks()) {
          await createFlutterMock(target, client, store);
        }
        return client;
      } catch (error) {
        // Force a fresh discovery next time — a relaunch changes the VM-service URL/token.
        this.vmServiceUrl = undefined;
        throw new Error(
          `browser.flutter.${command}: Dart VM Service is not connected (${(error as Error).message}). ` +
            'Ensure the app is a debug/profile build with `enableFlutterDriverExtension()` and is foregrounded.',
        );
      }
    };

    const api: FlutterServiceAPI = {
      execute: (async (script: string) => {
        const client = await ensureVmService('execute');
        return executeScript(client, script);
      }) as FlutterServiceAPI['execute'],

      mock: async (target: string) => {
        const client = await ensureVmService('mock');
        return createFlutterMock(target, client, store);
      },

      isMockFunction: (targetOrFn: unknown) => isMockFunctionUtil(targetOrFn, store),

      clearAllMocks: (targetPrefix?: string) => clearAllMocks(store, targetPrefix),
      resetAllMocks: (targetPrefix?: string) => resetAllMocks(store, targetPrefix),
      restoreAllMocks: (targetPrefix?: string) => restoreAllMocks(store, targetPrefix),

      triggerDeeplink: (url: string) => triggerDeeplink(browser, url),

      switchWindow: (context: string) => switchWindow(browser, context),
      listWindows: () => listWindows(browser),
    };

    (browser as WebdriverIO.Browser & { flutter?: FlutterServiceAPI }).flutter = api;
    log.debug('browser.flutter API installed');
  }

  async beforeTest(): Promise<void> {
    if (!this.store || !this.client?.connected) {
      if (this.store && (this.options.clearMocks || this.options.resetMocks || this.options.restoreMocks)) {
        log.warn('beforeTest: Dart VM Service not connected — clear/reset/restoreMocks skipped.');
      }
      return;
    }
    const store = this.store;
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
    if (!this.browser || !this.platform || !this.options.captureBackendLogs) {
      return;
    }
    const logType = this.platform === 'android' ? 'logcat' : 'syslog';
    forwardDeviceLogs(await collectDeviceLogs(this.browser, logType));
  }

  async after(): Promise<void> {
    await this.client?.close();
    this.client = undefined;
    this.store?.clear();
    this.store = undefined;
    this.browser = undefined;
    this.platform = undefined;
    this.vmServiceUrl = undefined;
  }

  async afterSession(): Promise<void> {
    await this.after();
  }
}
