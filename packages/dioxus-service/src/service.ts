import { createIpcInterceptor } from '@wdio/native-spy/interceptor';
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
    this.devServerUrl = (_options as DioxusServiceOptions).devServerUrl;
    log.debug('DioxusWorkerService initialised');
  }

  async before(_capabilities: unknown, _specs: string[], browser: WebdriverIO.Browser): Promise<void> {
    log.debug('DioxusWorkerService.before — installing browser.dioxus');

    if (this.devServerUrl) {
      await this.initBrowserMode(browser);
    } else {
      await this.injectSpy(browser);
    }

    // biome-ignore lint/suspicious/noExplicitAny: WebdriverIO.Browser augmentation
    // happens via @wdio/native-types module augmentation; the cast is a transient
    // accommodation for the in-progress migration.
    const dioxus: any = {
      execute: <R, A extends unknown[]>(script: Parameters<typeof execute<R, A>>[1], ...args: A): Promise<R> =>
        execute<R, A>(browser, script, ...args),
      mock: (command: string) => mock(command, browser),
      clearAllMocks,
      resetAllMocks,
      restoreAllMocks,
      isMockFunction,
      switchWindow: (label: string) => switchWindowByLabel(browser, label),
      listWindows: () => listWindowLabels(browser),
      triggerDeeplink,
    };
    (browser as unknown as { dioxus: typeof dioxus }).dioxus = dioxus;
  }

  async after(): Promise<void> {
    log.debug('DioxusWorkerService.after — clearing process-wide mockStore + window cache');
    mockStore.clear();
    clearWindowState();
  }

  private async initBrowserMode(browser: WebdriverIO.Browser): Promise<void> {
    log.debug(`Browser mode: navigating to ${this.devServerUrl}`);
    await browser.url(this.devServerUrl!);

    await this.injectSpy(browser);

    // Re-inject spy on every navigation so the mock infrastructure
    // survives page loads within the same test session.
    const originalUrl = (browser.url as unknown as (u?: string) => Promise<unknown>).bind(browser);
    const injectSpy = this.injectSpy.bind(this);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (browser as any).url = async (url?: string) => {
      const result = await originalUrl(url);
      if (url !== undefined) {
        await injectSpy(browser).catch((err) => {
          log.warn('Failed to re-inject spy after navigation:', err);
        });
      }
      return result;
    };
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
