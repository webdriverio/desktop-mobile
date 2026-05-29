import { createIpcInterceptor } from '@wdio/native-spy/interceptor';
import type { DioxusServiceAPI } from '@wdio/native-types';
import { createLogger, isBenignTeardownError, runBounded } from '@wdio/native-utils';

import { clearAllMocks, isMockFunction, resetAllMocks, restoreAllMocks } from './commands/allMocks.js';
import { execute } from './commands/execute.js';
import { mock } from './commands/mock.js';
import { triggerDeeplink } from './commands/triggerDeeplink.js';
import mockStore from './mockStore.js';
import type { DioxusServiceOptions } from './types.js';
import { clearWindowState, listWindowLabels, switchWindowByLabel } from './window.js';

const log = createLogger('dioxus-service', 'service');
const interceptor = createIpcInterceptor('dioxus');

const SESSION_DELETE_TIMEOUT_MS = 10_000;

/**
 * Delete a WebDriver session defensively during teardown. Bounded by a timeout
 * so a hanging/retrying DELETE can't block the worker until the CI step timeout,
 * and benign "session already gone / connection closed" errors are debug-logged
 * rather than rethrown — left to propagate, the retried DELETE closes the socket
 * and a libuv double-close assertion crashes the Windows worker after the test
 * already passed. See @wdio/native-utils teardown helpers.
 */
async function safeDeleteSession(browser: WebdriverIO.Browser, label: string): Promise<void> {
  if (!browser.sessionId) {
    return;
  }
  log.debug(`Deleting session${label ? ` for ${label}` : ''}: ${browser.sessionId}`);
  try {
    await runBounded(
      () => browser.deleteSession(),
      SESSION_DELETE_TIMEOUT_MS,
      () => log.debug(`deleteSession timed out after ${SESSION_DELETE_TIMEOUT_MS}ms${label ? ` (${label})` : ''}`),
    );
  } catch (error) {
    if (isBenignTeardownError(error)) {
      log.debug(`Ignoring benign teardown error during deleteSession${label ? ` (${label})` : ''}:`, error);
      return;
    }
    throw error;
  }
}

export default class DioxusWorkerService {
  private browser?: WebdriverIO.Browser | WebdriverIO.MultiRemoteBrowser;
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
    this.browser = browser;
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
    // mockStore is cleared in afterSession() *after* restoreAllMocks() so the
    // unregistration script can still iterate registered mocks. Clearing here
    // would leave window.__wdio_mocks__ populated across embedded-mode sessions.
    log.debug('DioxusWorkerService.after — clearing window cache');
    clearWindowState();
  }

  /**
   * Explicitly delete the WebDriver session. Without this, WDIO's `bail`/retry
   * features hit "invalid session id" on the second attempt because the worker
   * is reused but the previous session is no longer valid server-side.
   */
  async afterSession(): Promise<void> {
    log.debug('DioxusWorkerService.afterSession — deleting WebDriver session');

    try {
      await restoreAllMocks();
    } catch (error) {
      log.warn('Failed to restore mocks during session cleanup:', error);
    } finally {
      // Clear unconditionally — if restoreAllMocks() throws (commonly when the
      // browser session has already gone away and execute() rejects), leaving
      // the module-level mockStore populated causes the next session's
      // createMock() to stack on top of stale entries.
      mockStore.clear();
    }

    if (!this.browser) {
      clearWindowState();
      return;
    }

    try {
      if (!this.browser.isMultiremote) {
        await safeDeleteSession(this.browser as WebdriverIO.Browser, '');
      } else {
        const mrBrowser = this.browser as WebdriverIO.MultiRemoteBrowser;
        for (const instanceName of mrBrowser.instances) {
          try {
            await safeDeleteSession(mrBrowser.getInstance(instanceName), `instance ${instanceName}`);
          } catch (error) {
            log.warn(`Failed to delete session for instance ${instanceName}:`, error);
          }
        }
      }
    } catch (error) {
      log.warn('Failed to delete session:', error);
    } finally {
      clearWindowState();
    }
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
