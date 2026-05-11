// @wdio/dioxus-service launcher.
//
// PR2 Phase 1 (MVP): minimum viable launcher for provider `'external'` on
// Windows. Linux `'external'` is blocked per spike/FINDINGS.md; the launcher
// throws SevereServiceError at onPrepare. macOS users must use
// `'embedded'` (matching the Tauri precedent — wdio-dioxus-driver inherits
// tauri-driver's Windows-only support, minus Linux for us).
//
// Provider `'embedded'` is wired up in a later phase once
// `wdio-dioxus-embedded-driver` is on crates.io.

import { BaseLauncher } from '@wdio/native-core';
import { createLogger } from '@wdio/native-utils';
import type { Options } from '@wdio/types';

import { linuxExternalProviderUnsupported } from './errors.js';
import type { DioxusCapabilities, DioxusServiceGlobalOptions, DioxusServiceOptions } from './types.js';

const log = createLogger('dioxus-service', 'launcher');

export default class DioxusLaunchService extends BaseLauncher {
  constructor(
    private options: DioxusServiceGlobalOptions,
    capabilities: DioxusCapabilities,
    config: Options.Testrunner,
  ) {
    super({
      basePort: options.dioxusDriverPort ?? 4444,
      baseNativePort: (options.dioxusDriverPort ?? 4444) + 1,
    });
    log.debug('DioxusLaunchService initialised');
    log.debug('Capabilities:', JSON.stringify(capabilities, null, 2));
    log.debug('Config:', JSON.stringify(config, null, 2));
  }

  async onPrepare(
    _config: Options.Testrunner,
    capabilities: DioxusCapabilities[] | Record<string, { capabilities: DioxusCapabilities }>,
  ): Promise<void> {
    const firstCap = Array.isArray(capabilities) ? capabilities[0] : Object.values(capabilities)[0]?.capabilities;
    const mergedOptions = mergeOptions(this.options, firstCap?.['wdio:dioxusServiceOptions']);

    const provider = mergedOptions.driverProvider ?? 'embedded';
    if (provider === 'external' && process.platform === 'linux') {
      throw linuxExternalProviderUnsupported();
    }

    log.info(`Dioxus service onPrepare — provider: ${provider}, platform: ${process.platform}`);

    // Phase 1 stops here. Driver subprocess spawning lands in a follow-on
    // commit once the wdio-dioxus-driver crate is built and the bridge crate
    // is consumable by a Dioxus fixture app.
  }

  async onComplete(): Promise<void> {
    await this.stopAllDrivers();
  }
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
