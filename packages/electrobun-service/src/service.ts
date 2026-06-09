import { MultiTargetCdpBridge as CdpBridge } from '@wdio/native-cdp-bridge';
import type { ElectrobunServiceAPI } from '@wdio/native-types';
import { createLogger } from '@wdio/native-utils';

import { classifyTarget } from './cefClassifier.js';
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
  private options: ElectrobunServiceOptions;
  private bridges: CdpBridge[] = [];
  private mockStores: ElectrobunMockStore[] = [];

  constructor(options: ElectrobunServiceOptions, capabilities: unknown) {
    const capOptions = (capabilities as { 'wdio:electrobunServiceOptions'?: ElectrobunServiceOptions })[
      'wdio:electrobunServiceOptions'
    ];
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
    // installed (execute/mock have no in-app target to drive). Keyed on `mode`,
    // the same criterion the launcher uses — a stray devServerUrl without
    // mode: 'browser' must not skip the attach while the launcher spawns natively.
    if (this.options.mode === 'browser') {
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
    // The launcher sets debuggerAddress under `goog:chromeOptions` for the CEF/chromedriver
    // path and under `ms:edgeOptions` for the WebView2/Edge (msedgedriver) path — read both.
    const caps = capabilities as
      | { 'goog:chromeOptions'?: { debuggerAddress?: string }; 'ms:edgeOptions'?: { debuggerAddress?: string } }
      | undefined;
    const debuggerAddress = caps?.['goog:chromeOptions']?.debuggerAddress ?? caps?.['ms:edgeOptions']?.debuggerAddress;

    if (!debuggerAddress) {
      log.warn(
        'No goog:chromeOptions/ms:edgeOptions debuggerAddress on the capability — cannot attach the CDP bridge. ' +
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
      classifyTarget,
    });
    try {
      await bridge.connect();
    } catch (error) {
      // Dump what the endpoint actually exposed so a discovery/classification failure
      // (e.g. a renderer whose /json target shape differs from CEF's) is debuggable from
      // the logs rather than only surfacing as an opaque "no page targets" error.
      try {
        const res = await fetch(`http://${host}:${port}/json`);
        const raw = (await res.json()) as Array<{ type?: string; url?: string; title?: string }>;
        const summary = raw.map((t) => ({ type: t.type, url: t.url, title: t.title }));
        log.warn(`CDP bridge connect failed at ${host}:${port}; raw /json targets: ${JSON.stringify(summary)}`);
      } catch (probeError) {
        log.warn(`CDP bridge connect failed; /json probe also failed: ${(probeError as Error).message}`);
      }
      throw error;
    }
    this.bridges.push(bridge);

    const mockStore = new ElectrobunMockStore();
    this.mockStores.push(mockStore);
    installApi(browser, bridge, mockStore);

    await syncWebDriverWindow(browser, bridge);
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
 * Align the WebDriver session window with the CdpBridge's active target. Chromedriver,
 * attaching to the CEF debug port, makes its session window whatever page CEF lists
 * first — often a blank shell (`about:blank`) or the wrong content window when several
 * are open (the fixture opens main + second). The bridge (execute/mock) tracks its own
 * active target, so without this `$()`/`click`/`getText` would drift onto a different
 * window. Call after attach and after every `switchWindow` so element commands and
 * `execute` stay on the same window. Matches the active target by URL, falling back to
 * the first non-blank window. Best-effort: failures are logged, not fatal.
 */
async function syncWebDriverWindow(browser: WebdriverIO.Browser, bridge: CdpBridge): Promise<void> {
  try {
    const targets = bridge.listTargets();
    const targetUrl = targets.find((t) => t.label === bridge.activeLabel)?.url ?? targets[0]?.url;
    const handles = await browser.getWindowHandles();
    const originalHandle = await browser.getWindowHandle().catch(() => undefined);
    let fallback: string | undefined;
    for (const handle of handles) {
      await browser.switchToWindow(handle);
      const url = await browser.getUrl().catch(() => '');
      if (targetUrl && url === targetUrl) {
        return;
      }
      if (!fallback && url && !url.startsWith('about:') && !url.startsWith('chrome')) {
        fallback = handle;
      }
    }
    if (fallback) {
      await browser.switchToWindow(fallback);
      return;
    }
    // No match: don't strand the session on the last handle we probed — restore the
    // caller's original active window so element commands stay where they were.
    if (originalHandle) {
      await browser.switchToWindow(originalHandle).catch(() => {});
    }
    log.warn('No non-blank content window found; element commands may target a blank document.');
  } catch (error) {
    log.warn(`Could not sync the WebDriver window to the active target: ${(error as Error).message}`);
  }
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
    switchWindow: async (label: string) => {
      await bridge.switchTarget(label);
      // Move the WebDriver session window too — $/click must follow the switch, not
      // just execute/mock (which use the bridge's active target).
      await syncWebDriverWindow(browser, bridge);
    },
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
