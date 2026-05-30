import { BaseLauncher, closeLogWriter, isLogWriterInitialized } from '@wdio/native-core';
import { createLogger } from '@wdio/native-utils';
import type { Options } from '@wdio/types';

import { DEFAULT_REMOTE_DEBUGGING_PORT, SERVICE_NAME } from './constants.js';
import { SevereServiceError } from './errors.js';
import { getServiceOptionsFromCapability, mergeServiceOptions } from './serviceConfig.js';
import type { ElectrobunCapabilities, ElectrobunServiceGlobalOptions } from './types.js';

const log = createLogger(SERVICE_NAME, 'launcher');

/**
 * Main-process launcher for `@wdio/electrobun-service`.
 *
 * Electrobun is a CDP-attach framework: the launcher spawns the app binary and
 * the worker attaches over CDP through Chromedriver (`debuggerAddress`). It
 * extends `BaseLauncher` to reuse `@wdio/native-core`'s port/process/log infra —
 * the spawned app process plays the role the driver process does in the
 * Wry-based services.
 *
 * Native-mode launch (CEF verification, binary resolution, spawn + CEF debug
 * port discovery in 9222–9232) lands in the MVP PR. This foundation handles
 * service wiring and browser mode.
 */
export default class ElectrobunLaunchService extends BaseLauncher {
  constructor(
    private options: ElectrobunServiceGlobalOptions,
    capabilities: ElectrobunCapabilities,
    config: Options.Testrunner,
  ) {
    super({
      basePort: options.remoteDebuggingPort ?? DEFAULT_REMOTE_DEBUGGING_PORT,
      baseNativePort: (options.remoteDebuggingPort ?? DEFAULT_REMOTE_DEBUGGING_PORT) + 1,
    });
    log.debug('ElectrobunLaunchService initialised');
    log.debug('Capabilities:', JSON.stringify(capabilities, null, 2));
    log.debug('Config:', JSON.stringify(config, null, 2));
  }

  async onPrepare(
    _config: Options.Testrunner,
    capabilities: ElectrobunCapabilities[] | Record<string, { capabilities: ElectrobunCapabilities }>,
  ): Promise<void> {
    const capsList = normaliseCaps(capabilities);
    // Detect browser mode even when set on a non-first capability.
    const primaryCap =
      capsList.find(
        (cap) => mergeServiceOptions(this.options, getServiceOptionsFromCapability(cap)).mode === 'browser',
      ) ?? capsList[0];
    const mergedOptions = mergeServiceOptions(this.options, getServiceOptionsFromCapability(primaryCap));

    // Browser mode: skip all binary/CDP setup — the frontend runs against a dev
    // server in a plain Chrome session.
    if (mergedOptions.mode === 'browser') {
      const { devServerUrl } = mergedOptions;
      if (!devServerUrl) {
        throw new SevereServiceError('devServerUrl is required when mode is "browser"');
      }
      try {
        new URL(devServerUrl);
      } catch {
        throw new SevereServiceError(`devServerUrl is not a valid URL: ${devServerUrl}`);
      }
      for (const cap of capsList) {
        (cap as { browserName?: string }).browserName = 'chrome';
      }
      log.info('Browser mode enabled — skipping Electrobun binary/CDP setup');
      return;
    }

    // Native mode: CEF-renderer verification, binary resolution, app spawn, and
    // CEF debug-port discovery land in the MVP PR.
    log.warn('Native-mode Electrobun launch is not yet implemented in this pre-release.');
  }

  async onComplete(): Promise<void> {
    await this.stopAllDrivers();
    if (isLogWriterInitialized(SERVICE_NAME)) {
      await closeLogWriter(SERVICE_NAME);
    }
  }
}

function normaliseCaps(
  capabilities: ElectrobunCapabilities[] | Record<string, { capabilities: ElectrobunCapabilities }>,
): ElectrobunCapabilities[] {
  if (Array.isArray(capabilities)) {
    return capabilities;
  }
  return Object.values(capabilities).map((entry) => entry.capabilities);
}
