// @wdio/dioxus-service worker service.
//
// PR2 Phase 2: installs `browser.dioxus.execute` via the bridge's
// `window.__WDIO_DIOXUS__` IPC channel. Mocking + multi-window routing land
// in Phase 3 / Phase 4 alongside the DioxusAdapter in @wdio/native-spy and
// the bridge's window_state module.

import { createLogger } from '@wdio/native-utils';

import { execute } from './commands/execute.js';

const log = createLogger('dioxus-service', 'service');

export default class DioxusWorkerService {
  constructor(_options: unknown, _capabilities: unknown) {
    log.debug('DioxusWorkerService initialised');
  }

  async before(_capabilities: unknown, _specs: string[], browser: WebdriverIO.Browser): Promise<void> {
    log.debug('DioxusWorkerService.before — installing browser.dioxus');

    // biome-ignore lint/suspicious/noExplicitAny: WebdriverIO.Browser augmentation
    // happens via @wdio/native-types module augmentation; the cast is a transient
    // accommodation for the in-progress migration. Phase 3 tightens this.
    const dioxus: any = {
      execute: <R, A extends unknown[]>(script: Parameters<typeof execute<R, A>>[1], ...args: A): Promise<R> =>
        execute<R, A>(browser, script, ...args),
    };
    (browser as unknown as { dioxus: typeof dioxus }).dioxus = dioxus;
  }
}
