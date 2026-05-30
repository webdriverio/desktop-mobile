import { createLogger } from '@wdio/native-utils';

import { SERVICE_NAME } from './constants.js';
import type { ElectrobunServiceOptions } from './types.js';

const log = createLogger(SERVICE_NAME, 'service');

/**
 * Worker-process service for `@wdio/electrobun-service`. Installs the
 * `browser.electrobun.*` surface and drives it over the multi-target CDP bridge.
 *
 * The CDP attach + `browser.electrobun.*` installation (execute, mocking,
 * switchWindow/listWindows, log capture, triggerDeeplink) lands across the MVP
 * and feature-complete PRs. This foundation handles construction/wiring.
 */
export default class ElectrobunWorkerService {
  private browser?: WebdriverIO.Browser | WebdriverIO.MultiRemoteBrowser;
  private devServerUrl?: string;

  constructor(options: ElectrobunServiceOptions, capabilities: unknown) {
    const capOptions = (capabilities as { 'wdio:electrobunServiceOptions'?: ElectrobunServiceOptions })[
      'wdio:electrobunServiceOptions'
    ];
    this.devServerUrl = capOptions?.devServerUrl ?? options.devServerUrl;
    log.debug('ElectrobunWorkerService initialised');
  }

  async before(
    _capabilities: unknown,
    _specs: string[],
    browser: WebdriverIO.Browser | WebdriverIO.MultiRemoteBrowser,
  ): Promise<void> {
    this.browser = browser;
    // browser.electrobun.* installation over the CDP bridge lands in the MVP PR.
    log.warn('browser.electrobun.* surface is not yet installed in this pre-release.');
    void this.browser;
    void this.devServerUrl;
  }
}
