import { BaseLauncher } from '@wdio/native-core';
import { createLogger } from '@wdio/native-utils';
import type { Options } from '@wdio/types';
import { SevereServiceError } from 'webdriverio';

import { linuxExternalProviderUnsupported } from './errors.js';
import {
  type EmbeddedDriverInfo,
  getEmbeddedPort,
  startEmbeddedDriver,
  stopEmbeddedDriver,
} from './providers/embedded.js';
import type { DioxusCapabilities, DioxusServiceGlobalOptions, DioxusServiceOptions } from './types.js';

const log = createLogger('dioxus-service', 'launcher');

export default class DioxusLaunchService extends BaseLauncher {
  private embeddedProcesses: Map<string, EmbeddedDriverInfo> = new Map();

  constructor(
    private options: DioxusServiceGlobalOptions,
    capabilities: DioxusCapabilities,
    config: Options.Testrunner,
  ) {
    super({
      basePort: options.dioxusDriverPort ?? 9515,
      baseNativePort: (options.dioxusDriverPort ?? 9515) + 1,
    });
    log.debug('DioxusLaunchService initialised');
    log.debug('Capabilities:', JSON.stringify(capabilities, null, 2));
    log.debug('Config:', JSON.stringify(config, null, 2));
  }

  async onPrepare(
    _config: Options.Testrunner,
    capabilities: DioxusCapabilities[] | Record<string, { capabilities: DioxusCapabilities }>,
  ): Promise<void> {
    const capsList = normaliseCaps(capabilities);
    const firstCap = capsList[0];
    const mergedOptions = mergeOptions(this.options, firstCap?.['wdio:dioxusServiceOptions']);

    // Browser mode: skip all binary/driver setup — test runs against a Vite dev server
    if (mergedOptions.mode === 'browser') {
      const devServerUrl = mergedOptions.devServerUrl;
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
        delete (cap as { 'dioxus:options'?: unknown })['dioxus:options'];
      }
      log.info('Browser mode enabled — skipping driver/binary setup');
      return;
    }

    const provider = mergedOptions.driverProvider ?? 'embedded';

    if (provider === 'external' && process.platform === 'linux') {
      throw linuxExternalProviderUnsupported();
    }

    log.info(`Dioxus service onPrepare — provider: ${provider}, platform: ${process.platform}`);

    if (provider === 'embedded') {
      await this.prepareEmbedded(capsList);
    }
    // provider === 'external': wdio-dioxus-driver spawning wired in a follow-on commit
  }

  private async prepareEmbedded(capsList: DioxusCapabilities[]): Promise<void> {
    const hostname = '127.0.0.1';

    for (let i = 0; i < capsList.length; i++) {
      const cap = capsList[i];
      const instanceOptions = mergeOptions(this.options, cap['wdio:dioxusServiceOptions']);
      const embeddedPort = getEmbeddedPort(instanceOptions) + i;
      const appBinaryPath = cap['dioxus:options']?.application ?? instanceOptions.appBinaryPath;

      if (!appBinaryPath) {
        throw new SevereServiceError(
          'Dioxus application path not specified. ' +
            "Set 'dioxus:options'.application or appBinaryPath in wdio:dioxusServiceOptions.",
        );
      }

      const instanceId = String(i);
      log.info(`Starting embedded WebDriver for instance ${instanceId} on port ${embeddedPort}`);

      try {
        const driverInfo = await startEmbeddedDriver(appBinaryPath, embeddedPort, instanceOptions, instanceId);
        this.embeddedProcesses.set(instanceId, driverInfo);
      } catch (error) {
        await this.stopAllEmbedded();
        throw new SevereServiceError(
          `Failed to start embedded WebDriver for instance ${instanceId}: ${(error as Error).message}`,
        );
      }

      (cap as { port?: number; hostname?: string }).port = embeddedPort;
      (cap as { port?: number; hostname?: string }).hostname = hostname;
      log.info(`Embedded WebDriver connection set on capabilities[${i}]: ${hostname}:${embeddedPort}`);
    }
  }

  private async stopAllEmbedded(): Promise<void> {
    for (const [id, info] of this.embeddedProcesses) {
      log.info(`Stopping embedded driver instance ${id}`);
      await stopEmbeddedDriver(info).catch((err) => {
        log.warn(`Error stopping embedded driver ${id}: ${(err as Error).message}`);
      });
    }
    this.embeddedProcesses.clear();
  }

  async onComplete(): Promise<void> {
    await this.stopAllEmbedded();
    // Stop any external (wdio-dioxus-driver) processes managed by BaseLauncher
    await this.stopAllDrivers();
  }
}

/**
 * Flatten both array-caps and multiremote-caps shapes into a plain array.
 */
function normaliseCaps(
  caps: DioxusCapabilities[] | Record<string, { capabilities: DioxusCapabilities }>,
): DioxusCapabilities[] {
  if (Array.isArray(caps)) {
    return caps;
  }
  return Object.values(caps).map((v) => v.capabilities);
}

function mergeOptions(
  globalOptions: DioxusServiceGlobalOptions,
  capabilityOptions?: DioxusServiceOptions,
): DioxusServiceOptions {
  return {
    ...globalOptions,
    ...capabilityOptions,
    captureBackendLogs: capabilityOptions?.captureBackendLogs ?? globalOptions.captureBackendLogs ?? false,
    captureFrontendLogs: capabilityOptions?.captureFrontendLogs ?? globalOptions.captureFrontendLogs ?? false,
    backendLogLevel: capabilityOptions?.backendLogLevel ?? globalOptions.backendLogLevel ?? 'info',
    frontendLogLevel: capabilityOptions?.frontendLogLevel ?? globalOptions.frontendLogLevel ?? 'info',
  };
}
