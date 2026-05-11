// @wdio/dioxus-service worker service.
//
// PR2 Phase 3: installs the full `browser.dioxus.*` surface — execute +
// mock + mock-lifecycle helpers. Multi-window routing and triggerDeeplink
// land in PR3 alongside the bridge's window_state module.

import { createIpcInterceptor } from '@wdio/native-spy/interceptor';
import { createLogger } from '@wdio/native-utils';

import { clearAllMocks, isMockFunction, resetAllMocks, restoreAllMocks } from './commands/allMocks.js';
import { execute } from './commands/execute.js';
import { mock } from './commands/mock.js';
import mockStore from './mockStore.js';

const log = createLogger('dioxus-service', 'service');
const interceptor = createIpcInterceptor('dioxus');

export default class DioxusWorkerService {
  constructor(_options: unknown, _capabilities: unknown) {
    log.debug('DioxusWorkerService initialised');
  }

  async before(_capabilities: unknown, _specs: string[], browser: WebdriverIO.Browser): Promise<void> {
    log.debug('DioxusWorkerService.before — installing browser.dioxus');

    // Inject the @wdio/native-spy mock-factory infrastructure
    // (`window.__wdio_spy__` + `window.__wdio_mocks__`) and patch
    // `window.__WDIO_DIOXUS__.invoke` so registered mocks intercept calls.
    // Without this, every browser.dioxus.mock() call would fail at
    // registration with "@wdio/native-spy not available" because the
    // DioxusAdapter's buildRegistrationScript hard-guards on
    // `window.__wdio_spy__?.fn`.
    //
    // Phase 4 caveat: this script runs once at session start. If the test
    // navigates to a fresh page (browser.url) the spy infrastructure is
    // lost. Persistent re-injection on navigation will land alongside
    // the Tauri-style plugin-served setup in a later phase.
    try {
      await browser.execute(interceptor.buildBrowserIpcInjectionScript());
      log.debug('Injected @wdio/native-spy setup + wdio:// invoke patch');
    } catch (err) {
      log.warn(
        'Failed to inject mock-spy infrastructure in before(); ' +
          'browser.dioxus.mock() calls will fail. Is wdio_dioxus_bridge::install() ' +
          'wired into the Dioxus app? Underlying error:',
        err,
      );
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
    };
    (browser as unknown as { dioxus: typeof dioxus }).dioxus = dioxus;
  }

  /**
   * Drop every mock from the process-wide singleton store at the end of
   * the spec. Without this, a WDIO worker that processes multiple spec
   * files sequentially carries mocks created in spec A into spec B —
   * `clearAllMocks()` / `resetAllMocks()` / `restoreAllMocks()` would
   * then iterate over those stale mocks and dispatch inner-mock scripts
   * to a browser session that may already have moved on.
   *
   * We deliberately only `clear()` the JS-side registry, not call
   * `restoreAllMocks()` (which would try to unregister inner mocks in
   * the webview). The inner mocks die with the webview at session
   * teardown anyway.
   */
  async after(): Promise<void> {
    log.debug('DioxusWorkerService.after — clearing process-wide mockStore');
    mockStore.clear();
  }
}
