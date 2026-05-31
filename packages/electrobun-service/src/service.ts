import { CdpBridge } from '@wdio/electrobun-cdp-bridge';
import type { ElectrobunServiceAPI } from '@wdio/native-types';
import { createLogger } from '@wdio/native-utils';

import { clearAllMocks, isMockFunction, resetAllMocks, restoreAllMocks } from './commands/allMocks.js';
import { execute } from './commands/execute.js';
import { mock } from './commands/mock.js';
import { triggerDeeplink } from './commands/triggerDeeplink.js';
import { DEFAULT_REMOTE_DEBUGGING_PORT, SERVICE_NAME } from './constants.js';
import { ElectrobunMockStore } from './mockStore.js';
import type { ElectrobunServiceOptions } from './types.js';

const log = createLogger(SERVICE_NAME, 'service');

/** Parse a `host:port` debuggerAddress into its parts. Defaults the host to localhost. */
function parseDebuggerAddress(address: string): { host: string; port: number } {
  const lastColon = address.lastIndexOf(':');
  if (lastColon === -1) {
    return { host: 'localhost', port: DEFAULT_REMOTE_DEBUGGING_PORT };
  }
  const host = address.slice(0, lastColon) || 'localhost';
  const port = Number.parseInt(address.slice(lastColon + 1), 10);
  return { host, port: Number.isNaN(port) ? DEFAULT_REMOTE_DEBUGGING_PORT : port };
}

/**
 * Worker-process service for `@wdio/electrobun-service`. Attaches a CdpBridge to
 * the CEF debugger endpoint (`goog:chromeOptions.debuggerAddress`, set by the
 * launcher) and installs the `browser.electrobun.*` surface (execute, window
 * switching, mocking, and triggerDeeplink — all over the bridge).
 */
export default class ElectrobunWorkerService {
  private devServerUrl?: string;
  private options: ElectrobunServiceOptions;
  private bridges: CdpBridge[] = [];
  private mockStores: ElectrobunMockStore[] = [];

  constructor(options: ElectrobunServiceOptions, capabilities: unknown) {
    const capOptions = (capabilities as { 'wdio:electrobunServiceOptions'?: ElectrobunServiceOptions })[
      'wdio:electrobunServiceOptions'
    ];
    this.devServerUrl = capOptions?.devServerUrl ?? options.devServerUrl;
    this.options = { ...options, ...capOptions };
    log.debug('ElectrobunWorkerService initialised');
  }

  async before(
    capabilities: unknown,
    _specs: string[],
    browser: WebdriverIO.Browser | WebdriverIO.MultiRemoteBrowser,
  ): Promise<void> {
    // Browser mode: the frontend runs in a plain Chrome session against a dev
    // server — no CEF, no CDP side-channel. The electrobun surface is not
    // installed (execute/mock have no in-app target to drive).
    if (this.devServerUrl) {
      log.info('Browser mode — skipping CDP bridge attach');
      return;
    }

    if (browser.isMultiremote) {
      const mrBrowser = browser as WebdriverIO.MultiRemoteBrowser;
      for (const instanceName of mrBrowser.instances) {
        const instance = mrBrowser.getInstance(instanceName);
        await this.attachInstance(instance, capabilityFor(capabilities, instanceName));
      }
      return;
    }

    await this.attachInstance(browser as WebdriverIO.Browser, capabilities);
  }

  private async attachInstance(browser: WebdriverIO.Browser, capabilities: unknown): Promise<void> {
    const chromeOptions = (capabilities as { 'goog:chromeOptions'?: { debuggerAddress?: string } } | undefined)?.[
      'goog:chromeOptions'
    ];
    const debuggerAddress = chromeOptions?.debuggerAddress;

    if (!debuggerAddress) {
      log.warn(
        'No goog:chromeOptions.debuggerAddress on the capability — cannot attach the CDP bridge. ' +
          'browser.electrobun.* will be unavailable. Was the launcher (native mode) run?',
      );
      return;
    }

    const { host, port } = parseDebuggerAddress(debuggerAddress);
    log.info(`Attaching CDP bridge to ${host}:${port}`);

    const bridge = new CdpBridge({
      host,
      port,
      timeout: this.options.cdpConnectionTimeout,
      waitInterval: this.options.cdpConnectionRetryInterval,
      connectionRetryCount: this.options.cdpConnectionRetryCount,
    });
    await bridge.connect();
    this.bridges.push(bridge);

    const mockStore = new ElectrobunMockStore();
    this.mockStores.push(mockStore);
    installApi(browser, bridge, mockStore);
  }

  async after(): Promise<void> {
    await this.closeBridges();
  }

  async afterSession(): Promise<void> {
    await this.closeBridges();
  }

  private async closeBridges(): Promise<void> {
    for (const bridge of this.bridges) {
      await bridge.close().catch((error: Error) => {
        log.warn(`Failed to close CDP bridge: ${error.message}`);
      });
    }
    this.bridges = [];
    for (const store of this.mockStores) {
      store.clear();
    }
    this.mockStores = [];
  }
}

/** Resolve the per-instance capability from a multiremote capabilities map. */
function capabilityFor(capabilities: unknown, instanceName: string): unknown {
  if (capabilities && typeof capabilities === 'object' && instanceName in (capabilities as Record<string, unknown>)) {
    const entry = (capabilities as Record<string, { capabilities?: unknown }>)[instanceName];
    return entry?.capabilities ?? entry ?? capabilities;
  }
  return capabilities;
}

/**
 * Build and install the `browser.electrobun.*` surface backed by `bridge`. The
 * `mockStore` is per-installed-instance so multiremote instances keep separate
 * mock registries.
 */
function installApi(browser: WebdriverIO.Browser, bridge: CdpBridge, mockStore: ElectrobunMockStore): void {
  const electrobun: ElectrobunServiceAPI = {
    execute: <R, A extends unknown[]>(script: Parameters<typeof execute<R, A>>[1], ...args: A): Promise<R> =>
      execute<R, A>(bridge, script, ...args),
    switchWindow: (label: string) => bridge.switchTarget(label),
    listWindows: async () => bridge.listWindows(),
    mock: (target: string) => mock(target, bridge, mockStore),
    isMockFunction: (targetOrFn: unknown) => isMockFunction(targetOrFn, mockStore),
    clearAllMocks: (prefix?: string) => clearAllMocks(mockStore, prefix),
    resetAllMocks: (prefix?: string) => resetAllMocks(mockStore, prefix),
    restoreAllMocks: (prefix?: string) => restoreAllMocks(mockStore, prefix),
    triggerDeeplink: (url: string) => triggerDeeplink(url),
  };
  (browser as unknown as { electrobun: ElectrobunServiceAPI }).electrobun = electrobun;
  log.debug('Installed browser.electrobun.*');
}
