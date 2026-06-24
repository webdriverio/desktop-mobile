import type { CdpBridgeOptions } from '@wdio/native-cdp-bridge';

import type { ElectronServiceGlobalOptions } from '@wdio/native-types';
import { CUSTOM_CAPABILITY_NAME } from './constants.js';

export abstract class ServiceConfig {
  #globalOptions: ElectronServiceGlobalOptions;
  #cdpOptions: CdpBridgeOptions;
  #clearMocks = false;
  #resetMocks = false;
  #restoreMocks = false;
  #browser?: WebdriverIO.Browser | WebdriverIO.MultiRemoteBrowser;
  #userDataDir?: string;

  constructor(baseOptions: ElectronServiceGlobalOptions = {}, capabilities: WebdriverIO.Capabilities) {
    // Merge base options with capability-level options
    // Capability-level options take precedence
    this.#globalOptions = Object.assign({}, baseOptions, capabilities[CUSTOM_CAPABILITY_NAME]);

    const { clearMocks, resetMocks, restoreMocks } = this.#globalOptions;
    this.#clearMocks = clearMocks ?? false;
    this.#resetMocks = resetMocks ?? false;
    this.#restoreMocks = restoreMocks ?? false;

    this.#cdpOptions = {
      ...(this.#globalOptions.cdpBridgeTimeout && { timeout: this.#globalOptions.cdpBridgeTimeout }),
      ...(this.#globalOptions.cdpBridgeWaitInterval && {
        waitInterval: this.#globalOptions.cdpBridgeWaitInterval,
      }),
      ...(this.#globalOptions.cdpBridgeRetryCount && {
        connectionRetryCount: this.#globalOptions.cdpBridgeRetryCount,
      }),
    };

    // Extract user data directory from Chrome options
    this.#userDataDir = this.extractUserDataDir(capabilities);
  }

  /**
   * Extract the user data directory from Chrome options.
   * Looks for the --user-data-dir argument in goog:chromeOptions.args.
   *
   * @param capabilities - WebDriver capabilities
   * @returns The user data directory path, or undefined if not found
   */
  private extractUserDataDir(capabilities: WebdriverIO.Capabilities): string | undefined {
    const chromeOptions = capabilities['goog:chromeOptions'];
    if (!chromeOptions || typeof chromeOptions !== 'object') {
      return undefined;
    }

    const args = (chromeOptions as { args?: unknown }).args;
    if (!Array.isArray(args)) {
      return undefined;
    }

    for (const arg of args) {
      if (typeof arg === 'string' && arg.startsWith('--user-data-dir=')) {
        return arg.substring('--user-data-dir='.length);
      }
    }

    return undefined;
  }

  get globalOptions(): ElectronServiceGlobalOptions {
    return this.#globalOptions;
  }

  get browser(): WebdriverIO.Browser | WebdriverIO.MultiRemoteBrowser | undefined {
    return this.#browser;
  }

  set browser(browser: WebdriverIO.Browser | WebdriverIO.MultiRemoteBrowser) {
    this.#browser = browser;
  }

  protected get cdpOptions(): CdpBridgeOptions {
    return this.#cdpOptions;
  }

  protected get clearMocks() {
    return this.#clearMocks;
  }

  protected get resetMocks() {
    return this.#resetMocks;
  }

  protected get restoreMocks() {
    return this.#restoreMocks;
  }

  /**
   * Get the user data directory path extracted from capabilities.
   * This is used for Windows deeplink testing to ensure the deeplink
   * reaches the correct app instance.
   *
   * @returns The user data directory path, or undefined if not configured
   */
  get userDataDir(): string | undefined {
    return this.#userDataDir;
  }

  /**
   * Set the user data directory path.
   * This allows manual override of the extracted value if needed.
   *
   * @param dir - The user data directory path
   */
  set userDataDir(dir: string | undefined) {
    this.#userDataDir = dir;
  }
}
