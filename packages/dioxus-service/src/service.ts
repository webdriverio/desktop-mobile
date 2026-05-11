// @wdio/dioxus-service worker service.
//
// PR2 Phase 3: installs the full `browser.dioxus.*` surface — execute +
// mock + mock-lifecycle helpers. Multi-window routing and triggerDeeplink
// land in PR3 alongside the bridge's window_state module.

import { createLogger } from '@wdio/native-utils';

import { clearAllMocks, isMockFunction, resetAllMocks, restoreAllMocks } from './commands/allMocks.js';
import { execute } from './commands/execute.js';
import { mock } from './commands/mock.js';

const log = createLogger('dioxus-service', 'service');

export default class DioxusWorkerService {
  constructor(_options: unknown, _capabilities: unknown) {
    log.debug('DioxusWorkerService initialised');
  }

  async before(_capabilities: unknown, _specs: string[], browser: WebdriverIO.Browser): Promise<void> {
    log.debug('DioxusWorkerService.before — installing browser.dioxus');

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
}
