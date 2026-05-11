// @wdio/dioxus-service worker service.
//
// PR2 Phase 1: minimum viable worker. The `before()` hook installs a
// placeholder `browser.dioxus` object so capability + service-wiring tests
// pass. The actual `execute`, `mock`, etc. surface lands in Phase 2 once
// the bridge crate's `wdio://` IPC channel is wired up.

import { createLogger } from '@wdio/native-utils';

const log = createLogger('dioxus-service', 'service');

export default class DioxusWorkerService {
  constructor(_options: unknown, _capabilities: unknown) {
    log.debug('DioxusWorkerService initialised');
  }

  async before(_capabilities: unknown, _specs: string[], browser: WebdriverIO.Browser): Promise<void> {
    log.debug('DioxusWorkerService.before — installing browser.dioxus placeholder');
    // Placeholder: real API surface installed in Phase 2.
    (browser as unknown as { dioxus: Record<string, unknown> }).dioxus = {};
  }
}
