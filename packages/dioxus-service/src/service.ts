import { createIpcInterceptor } from '@wdio/native-spy/interceptor';
import type { DioxusServiceAPI } from '@wdio/native-types';
import { createLogger } from '@wdio/native-utils';

import { clearAllMocks, isMockFunction, resetAllMocks, restoreAllMocks } from './commands/allMocks.js';
import { execute } from './commands/execute.js';
import { mock } from './commands/mock.js';
import { triggerDeeplink } from './commands/triggerDeeplink.js';
import mockStore from './mockStore.js';
import type { DioxusServiceOptions } from './types.js';
import { clearWindowState, listWindowLabels, switchWindowByLabel } from './window.js';

const log = createLogger('dioxus-service', 'service');
const interceptor = createIpcInterceptor('dioxus');

export default class DioxusWorkerService {
  private devServerUrl?: string;

  constructor(_options: DioxusServiceOptions, _capabilities: unknown) {
    const capOptions = (_capabilities as { 'wdio:dioxusServiceOptions'?: DioxusServiceOptions })[
      'wdio:dioxusServiceOptions'
    ];
    this.devServerUrl = capOptions?.devServerUrl ?? _options.devServerUrl;
    log.debug('DioxusWorkerService initialised');
  }

  async before(
    _capabilities: unknown,
    _specs: string[],
    browser: WebdriverIO.Browser | WebdriverIO.MultiRemoteBrowser,
  ): Promise<void> {
    log.info(
      `before() start — mode=${this.devServerUrl ? 'browser' : 'native'} ` +
        `multiremote=${browser.isMultiremote} ` +
        `instances=${browser.isMultiremote ? (browser as WebdriverIO.MultiRemoteBrowser).instances.join(',') : 'n/a'}`,
    );

    let stage = 'init';
    try {
      if (this.devServerUrl) {
        stage = 'initBrowserMode';
        await this.initBrowserMode(browser as WebdriverIO.Browser);
        log.info('before() complete (browser mode)');
        return;
      }

      if (browser.isMultiremote) {
        const mrBrowser = browser as WebdriverIO.MultiRemoteBrowser;
        log.info(`Initializing ${mrBrowser.instances.length} multiremote instances`);
        stage = 'addDioxusApi:root';
        this.addDioxusApi(browser as unknown as WebdriverIO.Browser);
        for (const instanceName of mrBrowser.instances) {
          const mrInstance = mrBrowser.getInstance(instanceName);
          stage = `injectSpy:${instanceName}`;
          log.info(`Injecting spy + installing dioxus API on instance: ${instanceName}`);
          await this.injectSpy(mrInstance);
          stage = `addDioxusApi:${instanceName}`;
          this.addDioxusApi(mrInstance);
        }
      } else {
        stage = 'injectSpy:single';
        await this.injectSpy(browser as WebdriverIO.Browser);
        stage = 'addDioxusApi:single';
        this.addDioxusApi(browser as WebdriverIO.Browser);
      }
      log.info('before() complete');
    } catch (error) {
      log.error(
        `before() failed at stage="${stage}" — mode=${this.devServerUrl ? 'browser' : 'native'} ` +
          `multiremote=${browser.isMultiremote}`,
        error,
      );
      throw error;
    }
  }

  async after(): Promise<void> {
    log.debug('DioxusWorkerService.after — clearing process-wide mockStore + window cache');
    mockStore.clear();
    clearWindowState();
  }

  private addDioxusApi(browser: WebdriverIO.Browser): void {
    const dioxus: DioxusServiceAPI = {
      execute: <R, A extends unknown[]>(script: Parameters<typeof execute<R, A>>[1], ...args: A): Promise<R> =>
        execute<R, A>(browser, script, ...args),
      mock: (command: string) => mock(command, browser),
      clearAllMocks,
      resetAllMocks,
      restoreAllMocks,
      isMockFunction: (commandOrFn: unknown) => {
        if (typeof commandOrFn === 'string') {
          try {
            mockStore.getMock(`dioxus.${commandOrFn}`);
            return true;
          } catch {
            return false;
          }
        }
        return isMockFunction(commandOrFn);
      },
      switchWindow: (label: string) => switchWindowByLabel(browser, label),
      listWindows: () => listWindowLabels(browser),
      triggerDeeplink,
    };
    (browser as unknown as { dioxus: DioxusServiceAPI }).dioxus = dioxus;
  }

  private async initBrowserMode(browser: WebdriverIO.Browser): Promise<void> {
    log.debug(`Browser mode: navigating to ${this.devServerUrl}`);
    await browser.url(this.devServerUrl!);

    await this.injectSpy(browser);

    // Re-inject spy on every navigation so the mock infrastructure
    // survives page loads within the same test session.
    const originalUrl = (browser.url as unknown as (u?: string) => Promise<unknown>).bind(browser);
    const injectSpy = this.injectSpy.bind(this);
    (browser as unknown as { url: (u?: string) => Promise<unknown> }).url = async (url?: string) => {
      const result = url !== undefined ? await originalUrl(url) : await originalUrl();
      if (url !== undefined) {
        await injectSpy(browser).catch((err) => {
          log.warn('Failed to re-inject spy after navigation:', err);
        });
      }
      return result;
    };

    this.addDioxusApi(browser);
  }

  private async injectSpy(browser: WebdriverIO.Browser): Promise<void> {
    try {
      await browser.execute(interceptor.buildBrowserIpcInjectionScript());
      log.debug('Injected @wdio/native-spy setup + wdio:// invoke patch');
    } catch (err) {
      log.warn(
        'Failed to inject mock-spy infrastructure; browser.dioxus.mock() calls will fail. ' +
          'In native mode: is wdio_dioxus_bridge::install() wired into the Dioxus app? Underlying error:',
        err,
      );
    }
  }
}
