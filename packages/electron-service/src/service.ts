import type { CdpBridgeOptions } from '@wdio/electron-cdp-bridge';
import { createIpcInterceptor } from '@wdio/native-spy/interceptor';
import type {
  AbstractFn,
  BrowserExtension,
  ElectronFunctionMock,
  ElectronInterface,
  ElectronServiceGlobalOptions,
  ElectronType,
  ExecuteOpts,
} from '@wdio/native-types';
import { createLogger, waitUntilWindowAvailable } from '@wdio/native-utils';
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

function browserModeStoreKey(browser: WebdriverIO.Browser, channel: string): string {
  if (!browserModeInstanceIds.has(browser)) {
    browserModeInstanceIds.set(browser, browserModeInstanceCount++);
  }
  return `electron.${channel}\x00${browserModeInstanceIds.get(browser)}`;
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
    this.browser = instance as WebdriverIO.Browser;

    if (this.globalOptions.mode === 'browser') {
      await this.initBrowserMode(instance as WebdriverIO.Browser);
      return;
    }

    log.debug('Initialising CDP bridge...');

    const cdpBridge = this.browser.isMultiremote ? undefined : await initCdpBridge(this.cdpOptions, capabilities);

    // Initialize log capture if enabled
    // Note: Renderer logs work via Puppeteer and don't require CDP bridge
    // Main process logs require CDP bridge
    if (this.shouldCaptureElectronLogs()) {
      await this.initializeLogCapture(cdpBridge, this.browser);
    }

    /**
     * Add electron API to browser object
     */
    this.browser.electron = getElectronAPI.call(this, this.browser, cdpBridge);

    const isElectronApiAvailable = (browser: WebdriverIO.Browser, cdpBridge: ElectronCdpBridge | undefined) =>
      browser?.electron && typeof browser.electron.execute === 'function' && cdpBridge !== undefined;

    const hasElectronApi = isElectronApiAvailable(this.browser, cdpBridge);

    // Install command overrides if the electron API is available
    if (hasElectronApi) {
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

        const mrCdpBridge = await initCdpBridge(this.cdpOptions, caps);

        // Initialize log capture for this multiremote instance
        // Check if this specific instance has logging enabled
        const instanceOptions = caps[CUSTOM_CAPABILITY_NAME] || {};
        const shouldCaptureForInstance = instanceOptions.captureMainProcessLogs || instanceOptions.captureRendererLogs;
        if (shouldCaptureForInstance) {
          await this.initializeLogCapture(mrCdpBridge, mrInstance, instance, caps);
        }

        mrInstance.electron = getElectronAPI.call(this, mrInstance, mrCdpBridge);

        const mrPuppeteer = await getPuppeteer(mrInstance);
        mrInstance.electron.windowHandle = await getActiveWindowHandle(mrPuppeteer);

        // wait until an Electron BrowserWindow is available
        await waitUntilWindowAvailable(mrInstance);

        // Check if this specific instance has a functional electron API
        const hasElectronApiForMrInstance = isElectronApiAvailable(mrInstance, mrCdpBridge);

        if (hasElectronApiForMrInstance) {
          await copyOriginalApi(mrInstance);
        }
      }
    } else {
      const puppeteer = await getPuppeteer(this.browser);
      this.browser.electron.windowHandle = await getActiveWindowHandle(puppeteer);

      // wait until an Electron BrowserWindow is available
      await waitUntilWindowAvailable(this.browser);

      if (hasElectronApi) {
        await copyOriginalApi(this.browser);
      }
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
    await restoreAllMocks();
    mockStore.clear();
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

      const electronInstances: WebdriverIO.Browser[] = [];

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
        this.patchBrowserUrl(instance, injectionScript);
        electronInstances.push(instance);
      }

      // WDIO's multiremote overwriteCommand wrapper forwards the call to origOverwriteCommand
      // with all per-instance browsers as the `instances` argument. The underlying implementation
      // then registers the override on every instance's __elementOverrides__ directly, so both
      // mrBrowser.$('btn').click() and mrBrowser.getInstance('a').$('btn').click() go through
      // the override. Calling it on each instance separately would double-wrap element commands.
      browser.electron = this.getElectronBrowserModeAPI(browser);
      this.patchBrowserUrl(browser, injectionScript, electronInstances);
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
   * Patch browser.url() so the IPC injection script is re-applied after every
   * navigation. A page load wipes window state, losing __wdio_mocks__ and the
   * ipcRenderer patch.
   *
   * When called for the root multiremote browser, `electronInstances` must be
   * provided so re-injection targets only those browsers — root `execute()` would
   * otherwise broadcast to every session, including non-Electron ones.
   */
  private patchBrowserUrl(
    browser: WebdriverIO.Browser,
    injectionScript: string,
    electronInstances?: WebdriverIO.Browser[],
  ): void {
    type UrlFn = (href?: string) => Promise<string | void>;
    const originalUrl = (browser.url as unknown as UrlFn).bind(browser);
    (browser as unknown as { url: UrlFn }).url = async (href?: string): Promise<string | void> => {
      const result = await originalUrl(href);
      if (href !== undefined) {
        try {
          if (electronInstances) {
            await Promise.all(electronInstances.map((inst) => inst.execute(injectionScript)));
          } else {
            await browser.execute(injectionScript);
          }
        } catch (error) {
          log.warn('Failed to re-inject IPC script after navigation:', error);
          throw error;
        }
      }
      return result;
    };
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
        // Re-register browser-side entry only if navigation wiped window.__wdio_mocks__
        const isBrowserSideLive = (await browser.execute(
          `return !!(window.__wdio_mocks__ && typeof window.__wdio_mocks__[${JSON.stringify(channel)}] === 'function')`,
        )) as boolean;
        if (!isBrowserSideLive) {
          await browser.execute(`return (${browserInterceptor.buildRegistrationScript(channel)})()`);
          const replayImpl = (existing as unknown as Record<string, unknown>).__replayBrowserImpl;
          if (typeof replayImpl === 'function') {
            await (replayImpl as () => Promise<void>)();
          }
          await existing.mockClear();
        }
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
      const testOverride = async function (
        this: WebdriverIO.Element,
        originalCommand: (...args: readonly unknown[]) => Promise<unknown>,
        ...args: readonly unknown[]
      ): Promise<unknown> {
        // Use Reflect.apply to safely call the original command with the correct 'this' context
        // This avoids TypeScript's strict function signature checking while maintaining runtime safety
        const result = await Reflect.apply(originalCommand, this, args as unknown[]);
        await updateAllMocks();
        return result;
      } as Parameters<typeof browser.overwriteCommand>[1];

      browser.overwriteCommand(commandName, testOverride, true);
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

let mockUpdatePending = false;
let mockUpdatePromise: Promise<void> | null = null;

/**
 * Update all existing mocks with debouncing to prevent redundant updates.
 * Multiple rapid calls will coalesce into a single update.
 */
async function updateAllMocks() {
  if (mockUpdatePending && mockUpdatePromise) {
    return mockUpdatePromise;
  }

  mockUpdatePending = true;
  mockUpdatePromise = (async () => {
    log.debug('updateAllMocks called');
    const mocks = mockStore.getMocks();
    log.debug(`Found ${mocks.length} mocks to update`);

    if (mocks.length === 0) {
      log.debug('No mocks to update, returning');
      return;
    }

    try {
      log.debug('Starting mock update batch');
      await Promise.all(
        mocks.map(async ([mockId, mock]) => {
          log.debug(`Updating mock: ${mockId}`);
          await mock.update();
          log.debug(`Mock update completed: ${mockId}`);
        }),
      );
      log.debug('All mock updates completed successfully');
    } catch (error) {
      log.warn('Mock update batch failed:', error);
    } finally {
      mockUpdatePending = false;
    }
  })();

  return mockUpdatePromise;
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
  } as unknown as BrowserExtension['electron'];
}
