import {
  collectDeviceLogs,
  forwardDeviceLogs,
  listContexts,
  switchContext,
  triggerDeeplink,
} from '@wdio/native-mobile-core';
import type { FlutterServiceAPI } from '@wdio/native-types';
import { createLogger } from '@wdio/native-utils';

import {
  clearAllMocks,
  isMockFunction as isMockFunctionUtil,
  prefixCovers,
  resetAllMocks,
  restoreAllMocks,
} from './commands/allMocks.js';
import { emitEvent } from './commands/emitEvent.js';
import { executeScript } from './commands/execute.js';
import { byTextFinder, byValueKeyFinder, createFlutterElement } from './commands/finder.js';
import {
  CUSTOM_CAPABILITY_NAME,
  NATIVE_CONTEXT,
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
    // The device pool stamps appium:udid per worker — pass it to adb forward so parallel
    // Android workers each select their own emulator.
    const udid = (capabilities as { 'appium:udid'?: string })['appium:udid'];
    // Pinned VM-service port enables the discovery fast-path (skip the up-to-60s log scrape). The
    // wdio:flutterServiceOptions option wins; fall back to the appium:dartVmServicePort capability
    // so a user who pins it the documented way (directly on the cap) still gets the skip — matters
    // most on iOS, where syslog discovery is less reliable.
    const pinnedVmServicePort =
      this.options.vmServicePort ??
      (capabilities as { 'appium:dartVmServicePort'?: number })['appium:dartVmServicePort'];
    this.platform = platform;
    this.browser = browser;
    this.store = new FlutterMockStore();
    const store = this.store;

    const discover = () =>
      discoverVmServiceUrl(browser, {
        platform,
        udid,
        // Honour the documented CI-pinning options: skip the log scrape when set.
        pinnedPort: pinnedVmServicePort,
        host: this.options.vmServiceHost,
        retries: VM_SERVICE_CONNECT_RETRIES,
        intervalMs: VM_SERVICE_CONNECT_INTERVAL_MS,
      });

    // Connect on demand: the Dart VM Service URL is logged a few seconds after launch, so the
    // first execute/mock is often the point at which it's discoverable. Mirrors the RN service's
    // ensureHermes lazy-(re)connect — also covers reconnect after the app is backgrounded (the
    // isolate suspends and the socket drops).
    let connecting: Promise<VmServiceClient> | undefined;
    const ensureVmService = async (command: string): Promise<VmServiceClient> => {
      if (this.client?.connected) {
        return this.client;
      }
      // Single-flight: concurrent ops awaited during the connect window (e.g.
      // `Promise.all([browser.flutter.execute(...), browser.flutter.mock(...)])`) must share ONE
      // client — without this guard each opens its own VmServiceClient + adb-forward tunnel and
      // only the last `this.client` assignment survives, leaking the rest for the session.
      connecting ??= (async () => {
        try {
          // Drop a stale (disconnected) client before reconnecting so its socket doesn't linger.
          const stale = this.client;
          if (stale) {
            await stale.close().catch(() => undefined);
          }
          const connectTo = async (url: string) => {
            const c = new VmServiceClient(url);
            await c.connect();
            return c;
          };
          let client: VmServiceClient;
          if (this.vmServiceUrl) {
            // A cached URL goes stale after a *passive* socket drop — the app was killed and
            // relaunched between commands, which changes the VM-service URL/token. Try the cached
            // URL, but if the connect fails, rediscover and retry ONCE within this same call so the
            // first command after a relaunch self-heals, instead of throwing (forcing the caller to
            // retry) and only reconnecting on the *next* command.
            try {
              client = await connectTo(this.vmServiceUrl);
            } catch {
              this.vmServiceUrl = await discover();
              client = await connectTo(this.vmServiceUrl);
            }
          } else {
            this.vmServiceUrl = await discover();
            client = await connectTo(this.vmServiceUrl);
          }
          this.client = client;
          // No explicit mock re-wire needed: each mock resolves the live client lazily via
          // getClient (() => ensureVmService('mock')), so existing mocks pick up this new
          // connection on their next op. The Dart-side registry persists across the reconnect.
          return client;
        } catch (error) {
          // Force a fresh discovery next time — a relaunch changes the VM-service URL/token.
          this.vmServiceUrl = undefined;
          throw error; // rethrow raw — the awaiting caller attributes it to its own command below
        } finally {
          connecting = undefined;
        }
      })();
      try {
        return await connecting;
      } catch (error) {
        // Attribute the failure to THIS caller's command, not whichever command happened to win
        // the single-flight race and create `connecting` — so concurrent execute()+mock() each
        // surface the right command in the message.
        throw new Error(
          `browser.flutter.${command}: Dart VM Service is not connected (${(error as Error).message}). ` +
            'Ensure the app is a debug/profile build with `enableFlutterDriverExtension()` and is foregrounded.',
        );
      }
    };

    const api: FlutterServiceAPI = {
      execute: (async (name: string, ...args: unknown[]) => {
        const client = await ensureVmService('execute');
        return executeScript(client, name, args);
      }) as FlutterServiceAPI['execute'],

      mock: async (target: string) => {
        await ensureVmService('mock'); // fail fast if the app isn't reachable yet
        // Pass a resolver, not the client: the mock's ops reconnect-on-demand after a socket drop.
        return createFlutterMock(target, () => ensureVmService('mock'), store);
      },

      // Single runtime check; the overloaded signature (path→boolean, value→type guard) is static
      // only, so cast the impl to satisfy both overloads.
      isMockFunction: ((targetOrFn: unknown) =>
        isMockFunctionUtil(targetOrFn, store)) as FlutterServiceAPI['isMockFunction'],

      clearAllMocks: (targetPrefix?: string) => clearAllMocks(store, targetPrefix),
      resetAllMocks: (targetPrefix?: string) => resetAllMocks(store, targetPrefix),
      restoreAllMocks: (targetPrefix?: string) => restoreAllMocks(store, targetPrefix),

      emitEvent: async (name: string, payload?: unknown) => {
        const client = await ensureVmService('emitEvent');
        return emitEvent(client, name, payload);
      },

      triggerDeeplink: async (url: string) => {
        // Deeplinks are a native command — leave the FLUTTER/WEBVIEW context first if active.
        await switchContext(browser, NATIVE_CONTEXT).catch(() => undefined);
        return triggerDeeplink(browser, url);
      },

      switchContext: (context: string) => switchContext(browser, context),
      listContexts: () => listContexts(browser),

      byValueKey: (key: string | number) => createFlutterElement(browser, byValueKeyFinder(key)),
      byText: (text: string) => createFlutterElement(browser, byTextFinder(text)),
    };

    (browser as WebdriverIO.Browser & { flutter?: FlutterServiceAPI }).flutter = api;
    log.debug('browser.flutter API installed');

    // Pre-warm the VM-service URL while the "Dart VM service is listening on …" line is still in
    // the device-log ring buffer. The lazy connect above can first run minutes after launch (on
    // the first execute/mock), by which point that startup line has scrolled out and the one-shot
    // getLogs scrape finds nothing (appium-flutter-driver catches it only because it streams the
    // log from session start). Discovering here, right after launch, captures it; a later relaunch
    // re-scrapes its fresh line via the reconnect path. Best-effort — a miss falls back to the
    // lazy retry (e.g. a release build with no VM service, which then fails fast on first use).
    if (platform) {
      this.vmServiceUrl = (await discover().catch(() => undefined)) ?? this.vmServiceUrl;
    }
  }

  async beforeTest(): Promise<void> {
    const store = this.store;
    const wantsLifecycle = this.options.clearMocks || this.options.resetMocks || this.options.restoreMocks;
    // Run the lifecycle even if the socket dropped mid-test: the bulk ops resolve the client
    // lazily (reconnect-on-demand) and are best-effort per entry, so stale Dart mock state from
    // the previous test still gets cleared once the app is reachable again. No mocks → no-op
    // (and no reconnect attempt).
    if (!store || !wantsLifecycle || store.getMocks().length === 0) {
      return;
    }
    // Precedence: restore (removes the mock) ⊃ reset (clears value + calls) ⊃ clear (clears calls).
    // Skip an earlier op when a higher-precedence one runs on the SAME prefix — otherwise we redo
    // work the next op immediately discards (e.g. reset then restore on the same scope).
    const { clearMocks, resetMocks, restoreMocks, clearMocksPrefix, resetMocksPrefix, restoreMocksPrefix } =
      this.options;
    // Skip a lower-precedence op when a higher one runs on a scope that already *covers* it —
    // containment, not just an exact-prefix match: a restore-all (or reset of 'Foo') also makes a
    // clear of 'Foo.Bar' redundant.
    const clearRedundant =
      (resetMocks && prefixCovers(resetMocksPrefix, clearMocksPrefix)) ||
      (restoreMocks && prefixCovers(restoreMocksPrefix, clearMocksPrefix));
    const resetRedundant = restoreMocks && prefixCovers(restoreMocksPrefix, resetMocksPrefix);
    if (clearMocks && !clearRedundant) {
      await clearAllMocks(store, clearMocksPrefix);
    }
    if (resetMocks && !resetRedundant) {
      await resetAllMocks(store, resetMocksPrefix);
    }
    if (restoreMocks) {
      await restoreAllMocks(store, restoreMocksPrefix);
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
