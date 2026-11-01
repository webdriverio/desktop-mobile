import { forEachInstance, requireInstance } from '@wdio/native-core';
import { createIpcInterceptor } from '@wdio/native-spy/interceptor';
import type { DioxusMock, DioxusServiceAPI } from '@wdio/native-types';
import { createLogger, errorMessage, isMultiremote } from '@wdio/native-utils';

import {
  clearAllMocks,
  getMockOwners,
  isMockFunction,
  resetAllMocks,
  restoreAllMocks,
  runOnMockOwners,
} from './commands/allMocks.js';
import { execute, markAsEmbedded } from './commands/execute.js';
import { mock } from './commands/mock.js';
import { triggerDeeplink } from './commands/triggerDeeplink.js';
import mockStore, { type MockOwner } from './mockStore.js';
import { mergeOptions } from './serviceConfig.js';
import type { DioxusCapabilities, DioxusServiceOptions } from './types.js';
import { clearWindowState, listWindowLabels, switchWindowByLabel } from './window.js';

const log = createLogger('dioxus-service', 'service');
const interceptor = createIpcInterceptor('dioxus');

const MOCK_OPTION_OPS = [
  ['clearMocks', 'clearMocksPrefix', 'clearAllMocks', 'mockClear'],
  ['resetMocks', 'resetMocksPrefix', 'resetAllMocks', 'mockReset'],
  ['restoreMocks', 'restoreMocksPrefix', 'restoreAllMocks', 'mockRestore'],
] as const;

export default class DioxusWorkerService {
  private browser?: WebdriverIO.Browser | WebdriverIO.MultiRemoteBrowser;
  private devServerUrl?: string;
  private browserMode: boolean;
  private isEmbedded: boolean;
  private capabilities: unknown;
  private mockLifecycle: DioxusServiceOptions;

  constructor(_options: DioxusServiceOptions, _capabilities: unknown) {
    const capOptions = (_capabilities as { 'wdio:dioxusServiceOptions'?: DioxusServiceOptions })[
      'wdio:dioxusServiceOptions'
    ];
    // In multiremote, the launcher's mode: 'browser' is in each instance's capabilities, not the top level.
    const browserModeOptions =
      capOptions ??
      Object.values(_capabilities as Record<string, { capabilities?: DioxusCapabilities } | undefined>)
        .map((entry) => entry?.capabilities?.['wdio:dioxusServiceOptions'])
        .find((instanceOptions) => instanceOptions?.mode === 'browser');
    this.devServerUrl = browserModeOptions?.devServerUrl ?? _options.devServerUrl;
    this.browserMode = (browserModeOptions?.mode ?? _options.mode) === 'browser';
    this.isEmbedded = (capOptions?.driverProvider ?? _options.driverProvider ?? 'embedded') === 'embedded';
    this.capabilities = _capabilities;
    this.mockLifecycle = mergeOptions(_options, capOptions);
    log.debug('DioxusWorkerService initialised');
  }

  async before(
    _capabilities: unknown,
    _specs: string[],
    browser: WebdriverIO.Browser | WebdriverIO.MultiRemoteBrowser,
  ): Promise<void> {
    log.info(
      `before() start — mode=${this.browserMode ? 'browser' : 'native'} ` +
        `multiremote=${isMultiremote(browser)} ` +
        `instances=${isMultiremote(browser) ? (browser as WebdriverIO.MultiRemoteBrowser).instances.join(',') : 'n/a'}`,
    );
    this.browser = browser;

    let stage = 'init';
    try {
      if (this.browserMode) {
        stage = 'initBrowserMode';
        if (!this.devServerUrl) {
          throw new Error('devServerUrl is required for browser mode but was not set');
        }
        await this.initBrowserMode(browser as WebdriverIO.Browser, this.devServerUrl);
        log.info('before() complete (browser mode)');
        return;
      }

      if (isMultiremote(browser)) {
        log.info(`Initializing ${browser.instances.length} multiremote instances`);
        stage = 'addDioxusApi:root';
        this.addDioxusApi(browser as unknown as WebdriverIO.Browser);
      }
      await forEachInstance(browser, async (instance, { name }) => {
        if (name !== undefined) {
          log.info(`Injecting spy + installing dioxus API on instance: ${name}`);
        }
        stage = `injectSpy:${name ?? 'single'}`;
        await this.injectSpy(instance);
        stage = `addDioxusApi:${name ?? 'single'}`;
        this.addDioxusApi(instance);
      });
      log.info('before() complete');
    } catch (error) {
      log.error(
        `before() failed at stage="${stage}" — mode=${this.browserMode ? 'browser' : 'native'} ` +
          `multiremote=${isMultiremote(browser)}`,
        error,
      );
      throw error;
    }
  }

  async beforeTest(_test: unknown, _context: unknown): Promise<void> {
    if (!this.browser) {
      return;
    }
    const targets = await getMockOwners(this.browser, this.capabilities);
    // Run every configured op so one failure can't skip the others, then report them together.
    const failures: unknown[] = [];
    for (const [option, prefixOption, commandName, op] of MOCK_OPTION_OPS) {
      const enabled = targets.flatMap((target) => {
        const options = this.mockOptions(target.caps);
        return options[option] ? [{ ...target, prefix: options[prefixOption] }] : [];
      });
      if (enabled.length === 0) {
        continue;
      }
      try {
        await runOnMockOwners(commandName, enabled, op);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw failures.length === 1
        ? failures[0]
        : new AggregateError(failures, failures.map((error) => errorMessage(error)).join('; '));
    }
  }

  // A multiremote worker's capabilities are the whole record, so each instance's options come from its own caps
  private mockOptions(instanceCaps?: WebdriverIO.Capabilities): DioxusServiceOptions {
    return mergeOptions(
      this.mockLifecycle,
      (instanceCaps as DioxusCapabilities | undefined)?.['wdio:dioxusServiceOptions'],
    );
  }

  async after(): Promise<void> {
    log.debug('DioxusWorkerService.after — clearing window cache');
    clearWindowState();
  }

  async afterSession(): Promise<void> {
    log.debug('DioxusWorkerService.afterSession — clearing mock and window state');
    mockStore.clear();
    clearWindowState();
  }

  private addDioxusApi(browser: WebdriverIO.Browser): void {
    if (this.isEmbedded) {
      markAsEmbedded(browser);
    }
    const dioxus: DioxusServiceAPI = {
      execute: <R, A extends unknown[]>(script: Parameters<typeof execute<R, A>>[1], ...args: A): Promise<Awaited<R>> =>
        execute<R, A>(browser, script, ...args),
      mock: (command: string) => mock(command, browser),
      clearAllMocks: (prefix?: string) => clearAllMocks(browser, prefix),
      resetAllMocks: (prefix?: string) => resetAllMocks(browser, prefix),
      restoreAllMocks: (prefix?: string) => restoreAllMocks(browser, prefix),
      isMockFunction: ((commandOrFn: unknown) => {
        if (typeof commandOrFn === 'string') {
          return getMocksInScope(browser).some(([mockId]) => mockId === `dioxus.${commandOrFn}`);
        }
        return isMockFunction(commandOrFn);
      }) as DioxusServiceAPI['isMockFunction'],
      switchWindow: (label: string) => switchWindowByLabel(browser, label),
      listWindows: () => listWindowLabels(browser),
      triggerDeeplink,
    };
    (browser as unknown as { dioxus: DioxusServiceAPI }).dioxus = dioxus;
  }

  private async initBrowserMode(browser: WebdriverIO.Browser, devServerUrl: string): Promise<void> {
    log.debug(`Browser mode: navigating to ${devServerUrl}`);
    await browser.url(devServerUrl);

    await this.injectSpy(browser);

    // Re-inject the spy after every navigation so the mock infrastructure survives page
    // loads within the same test session. Uses overwriteCommand rather than reassigning
    // browser.url, which is a read-only command property on webdriverio (>=9.27) — direct
    // assignment throws "Cannot assign to read only property 'url'".
    const injectSpy = this.injectSpy.bind(this);
    browser.overwriteCommand('url', async function (
      this: WebdriverIO.Browser,
      originalUrl: (u?: string) => Promise<unknown>,
      url?: string,
    ): Promise<unknown> {
      const result = await Reflect.apply(originalUrl, this, [url]);
      if (url !== undefined) {
        await injectSpy(this).catch((err) => {
          log.warn('Failed to re-inject spy after navigation:', err);
        });
      }
      return result;
    } as Parameters<typeof browser.overwriteCommand>[1]);

    this.addDioxusApi(browser);
    if (isMultiremote(browser)) {
      const mrBrowser = browser as unknown as WebdriverIO.MultiRemoteBrowser;
      for (const instanceName of mrBrowser.instances) {
        this.addDioxusApi(requireInstance(mrBrowser, instanceName));
      }
    }
  }

  private async injectSpy(browser: WebdriverIO.Browser): Promise<void> {
    try {
      await browser.execute(interceptor.buildBrowserIpcInjectionScript());
      log.debug('Injected @wdio/native-spy setup + wdio:// invoke patch');
    } catch (err) {
      log.warn(
        'Failed to inject mock-spy infrastructure; browser.dioxus.mock() calls will fail. ' +
          'In native mode: is wdio_dioxus::install() wired into the Dioxus app? Underlying error:',
        err,
      );
    }
    if (this.isEmbedded) {
      await this.clearStaleMocks(browser);
    }
  }

  // Clear mocks left registered by previous sessions.
  private async clearStaleMocks(browser: WebdriverIO.Browser): Promise<void> {
    try {
      await browser.execute(function clearStaleMocks() {
        const page = globalThis as { __wdio_mocks__?: Record<string, unknown> };
        if (page.__wdio_mocks__) {
          page.__wdio_mocks__ = {};
        }
      });
      log.debug('Cleared stale mocks at session start');
    } catch (err) {
      log.warn('Failed to clear stale mocks at session start:', err);
    }
  }
}

// A multiremote root's commands reach every instance, so it sees every instance's mocks.
function getMocksInScope(browser: MockOwner): Array<[string, DioxusMock]> {
  return isMultiremote(browser) ? mockStore.getAllMocks() : mockStore.getMocks(browser);
}
