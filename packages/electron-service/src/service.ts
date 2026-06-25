import type { CdpBridgeOptions } from '@wdio/native-cdp-bridge';
import { createIpcInterceptor } from '@wdio/native-spy/interceptor';
import type {
  AbstractFn,
  BrowserExtension,
  ElectronFunctionMock,
  ElectronInterface,
  ElectronMock,
  ElectronMockReadAccessor,
  ElectronServiceGlobalOptions,
  ElectronType,
  ExecuteOpts,
} from '@wdio/native-types';
import {
  createLogger,
  DEFAULT_TEARDOWN_TIMEOUT_MS,
  installMockSyncOverride,
  isBenignTeardownError,
  runBounded,
  waitUntilWindowAvailable,
} from '@wdio/native-utils';
import type { Capabilities, Services } from '@wdio/types';
import { SevereServiceError } from 'webdriverio';
import { ElectronCdpBridge, getDebuggerEndpoint } from './bridge.js';
import { clearAllMocks } from './commands/clearAllMocks.js';
import { execute } from './commands/executeCdp.js';
import { isMockFunction } from './commands/isMockFunction.js';
import { mock } from './commands/mock.js';
import { mockAll } from './commands/mockAll.js';
import { resetAllMocks } from './commands/resetAllMocks.js';
import { restoreAllMocks } from './commands/restoreAllMocks.js';
import { triggerDeeplink } from './commands/triggerDeeplink.js';
import { CUSTOM_CAPABILITY_NAME } from './constants.js';
import { checkInspectFuse } from './fuses.js';
import { LogCaptureManager, type LogCaptureOptions } from './logCapture.js';
import { createElectronBrowserModeMock } from './mock.js';
import mockStore from './mockStore.js';
import { ServiceConfig } from './serviceConfig.js';
import { isInternalCommand } from './utils.js';
import { clearPuppeteerSessions, ensureActiveWindowFocus, getActiveWindowHandle, getPuppeteer } from './window.js';

const browserInterceptor = createIpcInterceptor('electron');
const browserModeInstanceIds = new WeakMap<WebdriverIO.Browser, number>();
let browserModeInstanceCount = 0;

function browserModeInstanceId(browser: WebdriverIO.Browser): number {
  let id = browserModeInstanceIds.get(browser);
  if (id === undefined) {
    id = browserModeInstanceCount++;
    browserModeInstanceIds.set(browser, id);
  }
  return id;
}

export function browserModeStoreKey(browser: WebdriverIO.Browser, channel: string): string {
  return `electron.${channel}\x00${browserModeInstanceId(browser)}`;
}

const mockUpdateSchedulers = new WeakMap<WebdriverIO.Browser, MockUpdateScheduler>();
const pendingRegistrations = new WeakMap<WebdriverIO.Browser, Map<string, Promise<void>>>();

/**
 * Coalesces mock-update round-trips so N concurrent DOM interactions don't each fire
 * one update per registered mock. At most two batches run at any moment (current +
 * one queued); callers arriving while a batch runs share the queued slot, so N
 * interactions produce <= 2 batches instead of N. Each batch syncs inner (app) mock
 * state to outer (test) mocks over a single CDP round-trip per transport lane. Each
 * lane is retried once (after 50 ms) before failing hard — silent swallow of
 * mock-update errors leaves mock.calls empty, which is harder to diagnose than an
 * AggregateError.
 */
class MockUpdateScheduler {
  #running: Promise<void> | null = null;
  #queued: Promise<void> | null = null;
  readonly #browser: WebdriverIO.Browser;

  constructor(browser: WebdriverIO.Browser) {
    this.#browser = browser;
  }

  schedule(): Promise<void> {
    if (!this.#running) {
      const p = this.#wrapRun(this.#runOnce());
      this.#running = p;
      return p;
    }
    if (!this.#queued) {
      this.#queued = this.#running.catch(() => undefined).then(() => this.#runOnce());
    }
    return this.#queued;
  }

  /**
   * Wrap a batch with an end-of-batch hook that atomically promotes any queued
   * follow-up into the running slot before clearing it. Without this hop, a
   * schedule() call arriving between the original batch settling and the
   * queued chain's #runOnce starting would observe #running=null and spawn a
   * third batch in parallel with the queued one.
   */
  #wrapRun(run: Promise<void>): Promise<void> {
    let wrapped!: Promise<void>;
    wrapped = run.finally(() => {
      if (this.#running !== wrapped) return;
      if (this.#queued) {
        const promoted = this.#queued;
        this.#queued = null;
        // The queued batch's callers hold `promoted` and observe its rejection there.
        // This wrapper is held only by #running and is never awaited externally, so
        // swallow its rejection — otherwise a failing queued batch surfaces as an
        // unhandled rejection (a worker crash under Node's default throw policy).
        const nextRunning = this.#wrapRun(promoted);
        nextRunning.catch(() => undefined);
        this.#running = nextRunning;
      } else {
        this.#running = null;
      }
    });
    return wrapped;
  }

  async #runOnce(): Promise<void> {
    log.debug('updateAllMocks batch start');
    // Native-mode mocks (key has no \x00) belong to every scheduler in the
    // process; browser-mode mocks (key ends with \x00<id>) are owned by a
    // single browser instance and must only be updated by that browser's
    // scheduler, otherwise mock.update() runs browser.execute() on the wrong
    // app context.
    const suffix = `\x00${browserModeInstanceId(this.#browser)}`;
    const mocks = mockStore.getMocks().filter(([key]) => !key.includes('\x00') || key.endsWith(suffix));
    log.debug(`Found ${mocks.length} mocks to update`);
    if (mocks.length === 0) return;

    // Split mocks by accessor kind so we can route each subset through the
    // right transport in exactly one round-trip: native mocks ride
    // browser.electron.execute() over CDP, browser-mode mocks ride a plain
    // browser.execute() against window.__wdio_mocks__. Mocks without an
    // accessor (legacy test doubles) fall back to per-mock update().
    const native: Array<[string, ElectronMock]> = [];
    const browserMode: Array<[string, ElectronMock]> = [];
    const legacy: Array<[string, ElectronMock]> = [];
    for (const entry of mocks) {
      const [, m] = entry;
      const acc = (m as { __accessor?: ElectronMockReadAccessor }).__accessor;
      if (acc?.kind === 'browser') {
        browserMode.push(entry);
      } else if (acc && typeof (m as { __applyCalls?: unknown }).__applyCalls === 'function') {
        native.push(entry);
      } else {
        legacy.push(entry);
      }
    }

    // Each lane is retried once (after 50 ms) before failing hard (see tryUpdate). Silently
    // swallowing a mock-update failure leaves mock.calls empty downstream, which is harder to
    // diagnose than an AggregateError surfaced at the call site. Empty native/browser lanes are
    // omitted — their batch helpers early-return, so including them only adds no-op scaffold.
    const lanes: Array<{ label: string; run: () => Promise<void> }> = [
      ...(native.length > 0 ? [{ label: 'native', run: () => batchUpdateNativeMocks(this.#browser, native) }] : []),
      ...(browserMode.length > 0
        ? [{ label: 'browser', run: () => batchUpdateBrowserModeMocks(this.#browser, browserMode) }]
        : []),
      ...legacy.map(([mockId, m]) => ({
        label: `legacy:${mockId}`,
        run: async () => {
          log.debug(`Updating legacy mock (no accessor): ${mockId}`);
          await m.update?.();
        },
      })),
    ];

    const results = await Promise.allSettled(lanes.map(({ label, run }) => tryUpdate(label, run)));
    const failures = results
      .map((result, i) => ({ result, label: lanes[i].label }))
      .filter((entry): entry is { result: PromiseRejectedResult; label: string } => entry.result.status === 'rejected');
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((f) => f.result.reason),
        `Mock updates failed for: ${failures.map((f) => f.label).join(', ')}`,
      );
    }
    log.debug('All mock updates completed successfully');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Run a single mock-update lane, retrying once after 50 ms before letting the failure
// propagate. Module-level so it isn't reallocated per batch — it closes over nothing but the
// module-level log/sleep.
async function tryUpdate(label: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (firstError) {
    log.debug(`Mock update lane "${label}" failed, retrying in 50ms:`, firstError);
    await sleep(50);
    await run();
  }
}

/**
 * Walk every registered native mock through a single browser.electron.execute()
 * round-trip. The inner script discriminates by accessor kind (api / prototype /
 * constructor), returns a map keyed by mockId, and each mock applies its own
 * slice locally via __applyCalls (no further I/O).
 */
async function batchUpdateNativeMocks(
  browser: WebdriverIO.Browser,
  entries: Array<[string, ElectronMock]>,
): Promise<void> {
  if (entries.length === 0) return;
  const items: Array<[string, ElectronMockReadAccessor]> = entries.map(([id, m]) => [
    id,
    (m as { __accessor: ElectronMockReadAccessor }).__accessor,
  ]);

  type NativeSlice = {
    calls: unknown[][];
    results: Array<{ type: string; value: unknown }>;
    __error?: string;
  };

  const data =
    (await browser.electron.execute<
      Record<string, NativeSlice>,
      [Array<[string, ElectronMockReadAccessor]>, ExecuteOpts]
    >(
      (electron, items) => {
        const out: Record<string, NativeSlice> = {};
        for (const item of items) {
          const id = item[0];
          const acc = item[1];
          try {
            let target:
              | { mock?: { calls?: unknown[][]; results?: Array<{ type: string; value: unknown }> } }
              | undefined;
            if (acc.kind === 'api') {
              const api = electron[acc.apiName as keyof typeof electron] as unknown as
                | Record<string, { mock?: { calls?: unknown[][]; results?: Array<{ type: string; value: unknown }> } }>
                | undefined;
              target = api?.[acc.funcName];
            } else if (acc.kind === 'prototype') {
              const cls = electron[acc.className as keyof typeof electron] as unknown as
                | {
                    prototype?: Record<
                      string,
                      { mock?: { calls?: unknown[][]; results?: Array<{ type: string; value: unknown }> } }
                    >;
                  }
                | undefined;
              target = cls?.prototype?.[acc.methodName];
            } else if (acc.kind === 'constructor') {
              target = electron[acc.className as keyof typeof electron] as unknown as typeof target;
            }
            if (target?.mock) {
              out[id] = {
                calls: target.mock.calls ? JSON.parse(JSON.stringify(target.mock.calls)) : [],
                results: target.mock.results ? JSON.parse(JSON.stringify(target.mock.results)) : [],
              };
            } else {
              out[id] = { calls: [], results: [] };
            }
          } catch (e) {
            // Surface the error to the WDIO worker — empty calls would
            // otherwise let assertions pass vacuously.
            out[id] = { calls: [], results: [], __error: e instanceof Error ? e.message : String(e) };
          }
        }
        return out;
      },
      items,
      { internal: true },
    )) ?? {};

  for (const [id, m] of entries) {
    const slice = data[id] ?? { calls: [], results: [] };
    if (slice.__error) {
      log.warn(`Native batch read failed for mock "${id}": ${slice.__error}`);
    }
    (
      m as { __applyCalls?: (d: { calls: unknown[][]; results?: Array<{ type: string; value: unknown }> }) => void }
    ).__applyCalls?.(slice);
  }
}

/**
 * Walk every registered browser-mode mock through a single browser.execute()
 * round-trip against window.__wdio_mocks__. Each channel's read script is
 * built by the interceptor (same serialisation contract as per-mock update()),
 * then the batch wrapper invokes them inside one round-trip. Ids and scripts
 * are passed as WebDriver args so null-byte mockStore keys don't ride a
 * source-string boundary. Raw payloads run through parseCallData() per mock
 * to reconstruct Error markers, then go to __applyCalls.
 */
async function batchUpdateBrowserModeMocks(
  browser: WebdriverIO.Browser,
  entries: Array<[string, ElectronMock]>,
): Promise<void> {
  if (entries.length === 0) return;
  const ids = entries.map(([id]) => id);
  const channels = entries.map(([, m]) => {
    const acc = (m as { __accessor: ElectronMockReadAccessor }).__accessor;
    return acc.kind === 'browser' ? acc.channel : '';
  });
  // One script per channel — same source the per-mock update() path uses, so
  // both paths share a single Error-serialisation contract.
  const perChannelScripts = channels.map((ch) => browserInterceptor.buildCallDataReadScript(ch));

  const raw = (await browser.execute(
    (innerIds: string[], innerScripts: string[]) => {
      const out: Record<string, unknown> = {};
      for (let i = 0; i < innerScripts.length; i++) {
        try {
          // biome-ignore lint/security/noGlobalEval: interceptor-built script wrapper
          const reader = new Function(`return (${innerScripts[i]});`)() as (...a: unknown[]) => unknown;
          out[innerIds[i]] = reader();
        } catch (e) {
          // Isolate per-reader failures so one bad channel doesn't tank the
          // whole batch — mirrors batchUpdateNativeMocks. The outer loop
          // surfaces __error via log.warn before forwarding to __applyCalls.
          out[innerIds[i]] = {
            calls: [],
            results: [],
            invocationCallOrder: [],
            __error: e instanceof Error ? e.message : String(e),
          };
        }
      }
      return out;
    },
    ids,
    perChannelScripts,
  )) as Record<string, unknown> | null;
  const data = raw && typeof raw === 'object' ? raw : {};

  for (const [id, m] of entries) {
    const slice = data[id] as { __error?: string } | undefined;
    if (slice?.__error) {
      log.warn(`Browser-mode batch read failed for mock "${id}": ${slice.__error}`);
    }
    const parsed = browserInterceptor.parseCallData(slice ?? null);
    (
      m as {
        __applyCalls?: (d: {
          calls: unknown[][];
          results?: Array<{ type: string; value: unknown }>;
          invocationCallOrder?: number[];
        }) => void;
      }
    ).__applyCalls?.(parsed);
  }
}

function getMockUpdateScheduler(browser: WebdriverIO.Browser): MockUpdateScheduler {
  let scheduler = mockUpdateSchedulers.get(browser);
  if (!scheduler) {
    scheduler = new MockUpdateScheduler(browser);
    mockUpdateSchedulers.set(browser, scheduler);
  }
  return scheduler;
}

const log = createLogger('electron-service', 'service');

type ElementCommands = 'click' | 'doubleClick' | 'setValue' | 'clearValue';

export default class ElectronWorkerService extends ServiceConfig implements Services.ServiceInstance {
  private logCaptureManager?: LogCaptureManager;

  constructor(
    globalOptions: ElectronServiceGlobalOptions = {},
    capabilities: WebdriverIO.Capabilities,
    _config?: unknown,
  ) {
    super(globalOptions, capabilities);
  }

  async before(
    capabilities: WebdriverIO.Capabilities,
    _specs: string[],
    instance: WebdriverIO.Browser | WebdriverIO.MultiRemoteBrowser,
  ): Promise<void> {
    log.info(
      `before() start — mode=${this.globalOptions.mode ?? 'binary'} ` +
        `multiremote=${instance.isMultiremote} ` +
        `instances=${instance.isMultiremote ? (instance as WebdriverIO.MultiRemoteBrowser).instances.join(',') : 'n/a'}`,
    );
    this.browser = instance as WebdriverIO.Browser;

    let stage = 'init';
    try {
      if (this.globalOptions.mode === 'browser') {
        stage = 'initBrowserMode';
        await this.initBrowserMode(instance as WebdriverIO.Browser);
        log.info('before() complete (browser mode)');
        return;
      }

      stage = 'initCdpBridge:root';
      log.info('Initialising CDP bridge...');
      const cdpBridge = this.browser.isMultiremote ? undefined : await initCdpBridge(this.cdpOptions, capabilities);

      // Initialize log capture if enabled
      // Note: Renderer logs work via Puppeteer and don't require CDP bridge
      // Main process logs require CDP bridge
      if (this.shouldCaptureElectronLogs()) {
        stage = 'initializeLogCapture:root';
        await this.initializeLogCapture(cdpBridge, this.browser);
      }

      /**
       * Add electron API to browser object
       */
      stage = 'getElectronAPI:root';
      this.browser.electron = getElectronAPI.call(this, this.browser, cdpBridge);

      const isElectronApiAvailable = (browser: WebdriverIO.Browser, cdpBridge: ElectronCdpBridge | undefined) =>
        browser?.electron && typeof browser.electron.execute === 'function' && cdpBridge !== undefined;

      const hasElectronApi = isElectronApiAvailable(this.browser, cdpBridge);

      // Install command overrides if the electron API is available
      if (hasElectronApi) {
        stage = 'installCommandOverrides';
        this.installCommandOverrides();
      }

      if (isMultiremote(instance)) {
        const mrBrowser = instance;

        // Set up electron API for the root multiremote browser
        // Use the first available instance's CDP bridge, or undefined if none available
        let rootCdpBridge: ElectronCdpBridge | undefined;

        for (const instanceName of mrBrowser.instances) {
          const mrInstance = mrBrowser.getInstance(instanceName);
          const caps =
            (mrInstance.requestedCapabilities as Capabilities.W3CCapabilities).alwaysMatch ||
            (mrInstance.requestedCapabilities as WebdriverIO.Capabilities);

          if (caps[CUSTOM_CAPABILITY_NAME]) {
            stage = `initCdpBridge:rootFrom:${instanceName}`;
            const mrCdpBridge = await initCdpBridge(this.cdpOptions, caps);
            if (mrCdpBridge && !rootCdpBridge) {
              rootCdpBridge = mrCdpBridge;
            }
            break; // Use the first available CDP bridge for the root
          }
        }

        mrBrowser.electron = getElectronAPI.call(this, mrBrowser as unknown as WebdriverIO.Browser, rootCdpBridge);

        for (const instance of mrBrowser.instances) {
          const mrInstance = mrBrowser.getInstance(instance);
          const caps =
            (mrInstance.requestedCapabilities as Capabilities.W3CCapabilities).alwaysMatch ||
            (mrInstance.requestedCapabilities as WebdriverIO.Capabilities);

          if (!caps[CUSTOM_CAPABILITY_NAME]) {
            continue;
          }

          stage = `initCdpBridge:${instance}`;
          log.info(`Initialising CDP bridge for instance: ${instance}`);
          const mrCdpBridge = await initCdpBridge(this.cdpOptions, caps);

          // Initialize log capture for this multiremote instance
          // Check if this specific instance has logging enabled
          const instanceOptions = caps[CUSTOM_CAPABILITY_NAME] || {};
          const shouldCaptureForInstance =
            instanceOptions.captureMainProcessLogs || instanceOptions.captureRendererLogs;
          if (shouldCaptureForInstance) {
            stage = `initializeLogCapture:${instance}`;
            await this.initializeLogCapture(mrCdpBridge, mrInstance, instance, caps);
          }

          mrInstance.electron = getElectronAPI.call(this, mrInstance, mrCdpBridge);

          stage = `getPuppeteer:${instance}`;
          const mrPuppeteer = await getPuppeteer(mrInstance);
          stage = `getActiveWindowHandle:${instance}`;
          mrInstance.electron.windowHandle = await getActiveWindowHandle(mrPuppeteer);

          // wait until an Electron BrowserWindow is available
          stage = `waitUntilWindowAvailable:${instance}`;
          await waitUntilWindowAvailable(mrInstance);

          // Check if this specific instance has a functional electron API
          const hasElectronApiForMrInstance = isElectronApiAvailable(mrInstance, mrCdpBridge);

          if (hasElectronApiForMrInstance) {
            stage = `copyOriginalApi:${instance}`;
            await copyOriginalApi(mrInstance);
          }
          log.info(`Instance ${instance} ready`);
        }
      } else {
        stage = 'getPuppeteer:single';
        const puppeteer = await getPuppeteer(this.browser);
        stage = 'getActiveWindowHandle:single';
        this.browser.electron.windowHandle = await getActiveWindowHandle(puppeteer);

        // wait until an Electron BrowserWindow is available
        stage = 'waitUntilWindowAvailable:single';
        await waitUntilWindowAvailable(this.browser);

        if (hasElectronApi) {
          stage = 'copyOriginalApi:single';
          await copyOriginalApi(this.browser);
        }
      }
      log.info('before() complete');
    } catch (error) {
      log.error(
        `before() failed at stage="${stage}" — mode=${this.globalOptions.mode ?? 'binary'} ` +
          `multiremote=${instance.isMultiremote}`,
        error,
      );
      throw error;
    }
  }

  async beforeTest() {
    if (this.clearMocks) {
      await clearAllMocks();
    }
    if (this.resetMocks) {
      await resetAllMocks();
    }
    if (this.restoreMocks) {
      await restoreAllMocks();
    }
  }

  async beforeCommand(commandName: string, args: unknown[]) {
    if (this.globalOptions.mode === 'browser') {
      return;
    }
    const excludeCommands = ['getWindowHandle', 'getWindowHandles', 'switchToWindow', 'execute'];
    if (!this.browser || excludeCommands.includes(commandName) || isInternalCommand(args)) {
      return;
    }
    await ensureActiveWindowFocus(this.browser, commandName);
  }

  after() {
    this.logCaptureManager?.stopCapture();
    clearPuppeteerSessions();
  }

  async afterSession() {
    // restoreAllMocks() drives a CDP send() per mock. During teardown the
    // debugger socket may already be gone, so a send() either rejects with
    // "WebSocket is not connected" or stalls against a half-open socket until
    // each per-command timeout fires — on Windows this hangs the worker until
    // the CI step timeout kills it, AFTER the test passed. Bound it and swallow
    // benign disconnect errors so teardown always completes. mockStore.clear()
    // must still run regardless so the next session starts with a clean store.
    try {
      await runBounded(
        () => restoreAllMocks(),
        DEFAULT_TEARDOWN_TIMEOUT_MS,
        () => log.debug('restoreAllMocks timed out during teardown'),
      );
    } catch (error) {
      if (isBenignTeardownError(error)) {
        log.debug('Ignoring benign teardown error during restoreAllMocks:', error);
      } else {
        log.warn('Failed to restore mocks during session cleanup:', error);
      }
    } finally {
      mockStore.clear();
    }
  }

  /**
   * Initialize browser-only mode: navigate to dev server, inject IPC layer, expose API.
   *
   * Timing note: the IPC interceptor is injected after browser.url() resolves
   * (i.e. after readyState === "complete"). Any ipcRenderer.invoke() calls the app
   * makes during module init or onload handlers will run against the real surface and
   * be missed by mocks. If your app does this, use a Vite plugin to import the
   * injection script as a top-level module in your dev build.
   */
  private async initBrowserMode(browser: WebdriverIO.Browser): Promise<void> {
    log.debug('Initialising Electron browser mode');
    const injectionScript = browserInterceptor.buildBrowserIpcInjectionScript();

    if ((browser as unknown as { isMultiremote?: boolean }).isMultiremote) {
      const mrBrowser = browser as unknown as WebdriverIO.MultiRemoteBrowser;
      (browser as unknown as Record<string, boolean>).__wdioElectronBrowserMode__ = true;

      for (const instanceName of mrBrowser.instances) {
        const instance = mrBrowser.getInstance(instanceName);
        const caps =
          (instance.requestedCapabilities as Capabilities.W3CCapabilities).alwaysMatch ||
          (instance.requestedCapabilities as WebdriverIO.Capabilities);

        if (!caps[CUSTOM_CAPABILITY_NAME]) {
          continue;
        }

        const instanceOptions = caps[CUSTOM_CAPABILITY_NAME] as ElectronServiceGlobalOptions | undefined;
        const instanceDevServerUrl = instanceOptions?.devServerUrl ?? this.globalOptions.devServerUrl;
        if (!instanceDevServerUrl) {
          throw new SevereServiceError(
            `devServerUrl is required for browser mode but was not set for multiremote instance "${instanceName}"`,
          );
        }

        await instance.url(instanceDevServerUrl);
        await instance.execute(injectionScript);
        (instance as unknown as Record<string, boolean>).__wdioElectronBrowserMode__ = true;
        instance.electron = this.getElectronBrowserModeAPI(instance);
      }

      // WDIO's multiremote overwriteCommand wrapper forwards the call to origOverwriteCommand
      // with all per-instance browsers as the `instances` argument. The underlying implementation
      // then registers the override on every instance's __elementOverrides__ directly, so both
      // mrBrowser.$('btn').click() and mrBrowser.getInstance('a').$('btn').click() go through
      // the override. Calling it on each instance separately would double-wrap element commands.
      browser.electron = this.getElectronBrowserModeAPI(browser);
      this.patchBrowserUrl(browser, injectionScript);
      this.installCommandOverrides(browser as unknown as WebdriverIO.Browser);
    } else {
      const devServerUrl = this.globalOptions.devServerUrl;
      if (!devServerUrl) {
        throw new SevereServiceError('devServerUrl is required for browser mode but was not set');
      }
      await browser.url(devServerUrl);
      await browser.execute(injectionScript);
      (browser as unknown as Record<string, boolean>).__wdioElectronBrowserMode__ = true;
      browser.electron = this.getElectronBrowserModeAPI(browser);
      this.patchBrowserUrl(browser, injectionScript);
      this.installCommandOverrides();
    }
    log.debug('Electron browser mode initialised');
  }

  /**
   * Override browser.url() so the IPC injection script is re-applied after every
   * navigation. A page load wipes window state, losing __wdio_mocks__ and the
   * ipcRenderer patch.
   *
   * Uses overwriteCommand rather than reassigning browser.url, which is a
   * read-only command property on webdriverio (>=9.27) — direct assignment throws
   * "Cannot assign to read only property 'url'". For multiremote the override
   * registers across all instances; the __wdioElectronBrowserMode__ guard skips
   * sessions not in Electron browser mode, and re-injection runs on the session
   * the navigation fired on (`this`).
   */
  private patchBrowserUrl(browser: WebdriverIO.Browser, injectionScript: string): void {
    browser.overwriteCommand(
      'url',
      async function (
        this: WebdriverIO.Browser,
        originalUrl: (href?: string) => Promise<string | void>,
        href?: string,
      ): Promise<string | void> {
        const result = await Reflect.apply(originalUrl, this, [href]);
        if (href !== undefined && (this as unknown as Record<string, boolean>).__wdioElectronBrowserMode__) {
          try {
            await this.execute(injectionScript);
          } catch (error) {
            log.warn('Failed to re-inject IPC script after navigation:', error);
            throw error;
          }
        }
        return result;
      } as Parameters<typeof browser.overwriteCommand>[1],
      false,
    );
  }

  /**
   * Build the browser.electron API surface for browser mode.
   * execute(), mockAll(), and triggerDeeplink() throw — they require the Electron
   * main process which does not exist in browser mode.
   */
  private getElectronBrowserModeAPI(browser: WebdriverIO.Browser): BrowserExtension['electron'] {
    const isRootMultiremote = (browser as unknown as { isMultiremote?: boolean }).isMultiremote === true;
    return {
      mock: async (channel: string, funcName?: string): Promise<ElectronFunctionMock> => {
        if (isRootMultiremote) {
          throw new Error(
            'browser.electron.mock() on the root multiremote browser is not supported in browser mode. ' +
              `Call it on a specific instance instead: mrBrowser.getInstance('name').electron.mock('${channel}')`,
          );
        }
        if (funcName !== undefined) {
          throw new Error(
            'browser.electron.mock(apiName, funcName) is not supported in browser mode. ' +
              `Use browser.electron.mock('${channel}') to mock the IPC channel directly.`,
          );
        }
        const storeKey = browserModeStoreKey(browser, channel);
        let existing: ElectronFunctionMock | undefined;
        try {
          existing = mockStore.getMock(storeKey) as ElectronFunctionMock;
        } catch (e) {
          if (!(e instanceof Error && e.message.startsWith('No mock registered for'))) {
            throw e;
          }
        }
        if (!existing) {
          const newMock = await createElectronBrowserModeMock(channel, browser);
          mockStore.setMockWithKey(storeKey, newMock);
          return newMock;
        }
        // Concurrent mock(channel) callers after navigation must share a single
        // re-registration: the liveness check, registration script, impl replay,
        // and mockClear all happen exactly once inside this gate.
        let inflight = pendingRegistrations.get(browser);
        if (!inflight) {
          inflight = new Map();
          pendingRegistrations.set(browser, inflight);
        }
        let registration = inflight.get(channel);
        if (!registration) {
          const target = existing;
          const run = (async () => {
            const isLive = (await browser.execute(
              `return !!(window.__wdio_mocks__ && typeof window.__wdio_mocks__[${JSON.stringify(channel)}] === 'function')`,
            )) as boolean;
            if (isLive) return;
            await browser.execute(`return (${browserInterceptor.buildRegistrationScript(channel)})()`);
            const replayImpl = (target as unknown as Record<string, unknown>).__replayBrowserImpl;
            if (typeof replayImpl === 'function') {
              await (replayImpl as () => Promise<void>)();
            }
            await target.mockClear();
          })();
          registration = run.finally(() => {
            if (inflight.get(channel) === registration) inflight.delete(channel);
          });
          inflight.set(channel, registration);
        }
        await registration;
        return existing;
      },
      mockAll: async () => {
        throw new Error(
          'browser.electron.mockAll() is not supported in browser mode. ' +
            "Use browser.electron.mock('channel') to mock individual IPC channels.",
        );
      },
      execute: async () => {
        throw new Error(
          'browser.electron.execute() is not supported in browser mode. ' +
            'Use browser.execute() for renderer code or browser.electron.mock() to intercept IPC.',
        );
      },
      clearAllMocks: async (commandPrefix?: string) => clearAllMocks.call(this, commandPrefix),
      resetAllMocks: async (commandPrefix?: string) => resetAllMocks.call(this, commandPrefix),
      restoreAllMocks: async (commandPrefix?: string) => restoreAllMocks.call(this, commandPrefix),
      isMockFunction: (fn: unknown) => isMockFunction.call(this, fn),
      triggerDeeplink: async () => {
        throw new Error('browser.electron.triggerDeeplink() is not supported in browser mode.');
      },
      emitEvent: async (channel: string, ...args: unknown[]): Promise<void> => {
        if (isRootMultiremote) {
          throw new Error(
            'browser.electron.emitEvent() on the root multiremote browser is not supported in browser mode. ' +
              `Call it on a specific instance instead: mrBrowser.getInstance('name').electron.emitEvent('${channel}', ...)`,
          );
        }
        await (browser.execute as (fn: (...a: unknown[]) => unknown, ...a: unknown[]) => Promise<unknown>)(
          (...inner: unknown[]) => {
            const [c, a] = inner as [string, unknown[]];
            const w = window as unknown as {
              __wdio_emit_electron_event__?: (channel: string, ...args: unknown[]) => void;
            };
            if (!w.__wdio_emit_electron_event__) {
              throw new Error('Electron event registry not initialised — is browser mode active?');
            }
            w.__wdio_emit_electron_event__(c, ...a);
          },
          channel,
          args,
        );
        await getMockUpdateScheduler(browser).schedule();
      },
    } as unknown as BrowserExtension['electron'];
  }

  /**
   * Install command overrides to trigger mock updates after DOM interactions
   */
  private installCommandOverrides(targetBrowser?: WebdriverIO.Browser) {
    const commandsToOverride = ['click', 'doubleClick', 'setValue', 'clearValue'];
    commandsToOverride.forEach((commandName) => {
      this.overrideElementCommand(commandName as ElementCommands, targetBrowser);
    });
  }

  /**
   * Override an element-level command to add mock update after execution
   */
  private overrideElementCommand(commandName: ElementCommands, targetBrowser?: WebdriverIO.Browser) {
    const browser = (targetBrowser ?? this.browser) as WebdriverIO.Browser;
    try {
      // In multiremote, the override is registered on the root but fires per
      // instance — element.browser is the per-instance owning session. Route
      // through that browser's scheduler so per-instance mock keys match;
      // otherwise the root scheduler filters everything out.
      installMockSyncOverride(browser, commandName, (element) => {
        const ownerBrowser = (element as { browser?: WebdriverIO.Browser }).browser ?? browser;
        return getMockUpdateScheduler(ownerBrowser).schedule();
      });
    } catch (error) {
      log.warn(`Failed to override element command '${commandName}':`, error);
    }
  }

  /**
   * Check if Electron log capture is enabled
   */
  private shouldCaptureElectronLogs(): boolean {
    return !!(this.globalOptions.captureMainProcessLogs || this.globalOptions.captureRendererLogs);
  }

  /**
   * Initialize log capture for Electron processes
   * Main process logs require CDP bridge; renderer logs use Puppeteer independently
   */
  private async initializeLogCapture(
    cdpBridge: ElectronCdpBridge | undefined,
    browser: WebdriverIO.Browser,
    instanceId?: string,
    capabilities?: WebdriverIO.Capabilities,
  ): Promise<void> {
    try {
      // For multiremote, use capabilities from the specific instance
      // For standard mode, use globalOptions
      const options = capabilities?.[CUSTOM_CAPABILITY_NAME] || this.globalOptions;

      const logOptions: LogCaptureOptions = {
        captureMainProcessLogs: options.captureMainProcessLogs ?? false,
        captureRendererLogs: options.captureRendererLogs ?? false,
        mainProcessLogLevel: options.mainProcessLogLevel ?? 'info',
        rendererLogLevel: options.rendererLogLevel ?? 'info',
        logDir: options.logDir,
      };

      // Create log capture manager only once (for multiremote, reuse the same instance)
      if (!this.logCaptureManager) {
        this.logCaptureManager = new LogCaptureManager();
      }

      // Main process logs require CDP bridge
      if (logOptions.captureMainProcessLogs) {
        if (cdpBridge) {
          await this.logCaptureManager.captureMainProcessLogs(cdpBridge, logOptions, instanceId);
        } else {
          log.warn(
            'Main process log capture requested but CDP bridge is unavailable. ' +
              'This may be due to EnableNodeCliInspectArguments fuse being disabled.',
          );
        }
      }

      // Renderer logs use Puppeteer and work independently of CDP bridge
      if (logOptions.captureRendererLogs) {
        const puppeteerBrowser = await getPuppeteer(browser);
        await this.logCaptureManager.captureRendererLogs(puppeteerBrowser, logOptions, instanceId);
      }
    } catch (error) {
      log.warn('Failed to initialize log capture:', error);
    }
  }
}

function isMultiremote(
  browser: WebdriverIO.Browser | WebdriverIO.MultiRemoteBrowser,
): browser is WebdriverIO.MultiRemoteBrowser {
  return browser.isMultiremote;
}

async function initCdpBridge(
  cdpOptions: CdpBridgeOptions,
  capabilities: WebdriverIO.Capabilities,
): Promise<ElectronCdpBridge | undefined> {
  try {
    // Check if the Electron binary has the necessary fuse enabled
    const binaryPath = capabilities['goog:chromeOptions']?.binary;
    if (binaryPath && typeof binaryPath === 'string') {
      const fuseCheck = await checkInspectFuse(binaryPath);

      // Fuse is disabled - cannot use CDP bridge
      if (!fuseCheck.canUseCdpBridge) {
        // Don't warn here - this will be handled by the API stub functions
        return undefined;
      }

      // Fuse check encountered an error but we're proceeding anyway
      if (fuseCheck.error) {
        log.warn(fuseCheck.error);
      }
    }

    const options = Object.assign({}, cdpOptions, getDebuggerEndpoint(capabilities));

    const cdpBridge = new ElectronCdpBridge(options);
    await cdpBridge.connect();
    return cdpBridge;
  } catch (error) {
    log.warn(
      'CDP bridge initialization failed — electron.execute(), mock(), and related APIs will be unavailable:',
      error,
    );
    return undefined;
  }
}

const copyOriginalApi = async (browser: WebdriverIO.Browser) => {
  await browser.electron.execute<void, [ExecuteOpts]>(
    async (electron) => {
      const { copy: fastCopy } = await import('fast-copy');
      globalThis.originalApi = {} as unknown as Record<ElectronInterface, ElectronType[ElectronInterface]>;
      for (const api in electron) {
        const apiName = api as keyof ElectronType;
        globalThis.originalApi[apiName] = {} as ElectronType[ElectronInterface];
        for (const apiElement in electron[apiName]) {
          const apiElementName = apiElement as keyof ElectronType[ElectronInterface];
          globalThis.originalApi[apiName][apiElementName] = fastCopy(electron[apiName][apiElementName]);
        }
      }
    },
    { internal: true },
  );
};

function getElectronAPI(this: ServiceConfig, browser: WebdriverIO.Browser, cdpBridge?: ElectronCdpBridge) {
  const disabledApiFunc = () => {
    log.warn('CDP bridge is not available, API is disabled');
    log.warn('This may be due to EnableNodeCliInspectArguments fuse being disabled or other connection issues.');
    log.warn('To enable the CDP bridge, ensure this fuse is enabled in your test builds.');
    log.warn('See: https://www.electronjs.org/docs/latest/tutorial/fuses#nodecliinspect');
    throw new Error('CDP bridge is not available, API is disabled');
  };

  // Helper to get the bound implementation or disabled func
  const getMethod = (impl: (...args: never[]) => unknown, requiresCdp = true) => {
    return !cdpBridge && requiresCdp ? disabledApiFunc : impl;
  };

  return {
    clearAllMocks: getMethod(clearAllMocks.bind(this)),
    execute: getMethod((script: string | AbstractFn, ...args: unknown[]) =>
      execute.apply(this, [browser, cdpBridge as ElectronCdpBridge, script, ...args]),
    ),
    isMockFunction: getMethod(isMockFunction.bind(this)),
    mock: getMethod(mock.bind(this)),
    mockAll: getMethod(mockAll.bind(this)),
    resetAllMocks: getMethod(resetAllMocks.bind(this)),
    restoreAllMocks: getMethod(restoreAllMocks.bind(this)),
    triggerDeeplink: getMethod(triggerDeeplink.bind(this), false), // doesn't require CDP
    emitEvent: getMethod(async (channel: string, ...args: unknown[]): Promise<void> => {
      await execute.apply(this, [
        browser,
        cdpBridge as ElectronCdpBridge,
        (electron, ...inner: unknown[]) => {
          const [c, a] = inner as [string, unknown[]];
          const win = electron.BrowserWindow.getFocusedWindow() ?? electron.BrowserWindow.getAllWindows()[0];
          if (!win) {
            throw new Error('emitEvent: no BrowserWindow available to receive event');
          }
          win.webContents.send(c, ...a);
        },
        channel,
        args,
      ]);
      // webContents.send is fire-and-forget from main → renderer. Round-trip
      // through the renderer with a no-op script so any ipcRenderer.on
      // listener has fired (and any mocked IPC calls it makes have landed)
      // before we sample mock state. Mirrors the browser-mode path, which
      // dispatches listeners synchronously in-page.
      await browser.execute(() => undefined);
      await getMockUpdateScheduler(browser).schedule();
    }),
  } as unknown as BrowserExtension['electron'];
}
