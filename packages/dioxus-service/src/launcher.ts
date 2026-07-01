import { join } from 'node:path';

import {
  BaseLauncher,
  closeLogWriter,
  getLogWriter,
  isLogWriterInitialized,
  nonChromeBrowserNameError,
  probeDevServerReachable,
  startManagedDevServer,
} from '@wdio/native-core';
import { createLogger, isErr } from '@wdio/native-utils';
import type { Options } from '@wdio/types';
import { SevereServiceError } from 'webdriverio';

import { linuxExternalProviderUnsupported, macosExternalProviderUnsupported } from './errors.js';
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
  // Teardown for a service-managed dev server (browser mode). Called from onComplete AND on an
  // onPrepare failure — WDIO does not call onComplete after onPrepare throws. Idempotent.
  #stopDevServer?: () => Promise<void>;

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
    // Use the first capability with mode='browser' as the options source so that
    // browser mode is detected even when set on a non-first capability.
    const primaryCap =
      capsList.find((cap) => mergeOptions(this.options, cap['wdio:dioxusServiceOptions']).mode === 'browser') ??
      capsList[0];
    const mergedOptions = mergeOptions(this.options, primaryCap?.['wdio:dioxusServiceOptions']);

    // Browser mode: skip all binary/driver setup — test runs against a Vite dev server
    if (mergedOptions.mode === 'browser') {
      let devServerUrl = mergedOptions.devServerUrl;
      // Auto-manage the dev server if requested; the managed readiness wait supersedes the
      // one-shot preflight below, and a devServer function may supply the URL.
      if (mergedOptions.devServer) {
        try {
          const managed = await startManagedDevServer(mergedOptions.devServer, devServerUrl ?? '');
          this.#stopDevServer = managed.stop;
          devServerUrl = managed.url || devServerUrl;
        } catch (error) {
          await this.#stopDevServer?.();
          throw new SevereServiceError(`Failed to start dev server: ${(error as Error).message}`);
        }
      }
      if (!devServerUrl) {
        throw new SevereServiceError(
          'devServerUrl is required when mode is "browser" (set it, or return a url from a devServer function)',
        );
      }
      try {
        new URL(devServerUrl);
      } catch {
        throw new SevereServiceError(`devServerUrl is not a valid URL: ${devServerUrl}`);
      }
      for (const cap of capsList) {
        const browserNameError = nonChromeBrowserNameError((cap as { browserName?: string }).browserName, [
          'chrome',
          'dioxus',
        ]);
        if (browserNameError) {
          throw new SevereServiceError(browserNameError);
        }
      }
      if (!mergedOptions.devServer) {
        // Unmanaged: preflight the user-started server before workers navigate to it.
        const reachable = await probeDevServerReachable(devServerUrl);
        if (isErr(reachable)) {
          throw new SevereServiceError(reachable.error.message);
        }
      }
      for (const cap of capsList) {
        (cap as { browserName?: string }).browserName = 'chrome';
        delete (cap as { 'dioxus:options'?: unknown })['dioxus:options'];
        // Propagate the resolved URL (a devServer function may have overridden it) to the worker,
        // which reads devServerUrl from its capability options.
        const capRecord = cap as Record<string, unknown>;
        capRecord['wdio:dioxusServiceOptions'] = {
          ...(capRecord['wdio:dioxusServiceOptions'] as Record<string, unknown> | undefined),
          devServerUrl,
        };
      }
      log.info('Browser mode enabled — skipping driver/binary setup');
      return;
    }

    const provider = mergedOptions.driverProvider ?? 'embedded';

    if (provider === 'external') {
      if (process.platform === 'linux') throw linuxExternalProviderUnsupported();
      if (process.platform === 'darwin') throw macosExternalProviderUnsupported();
    }

    log.info(`Dioxus service onPrepare — provider: ${provider}, platform: ${process.platform}`);

    // Initialise the LogWriter before spawning the embedded driver so the
    // startup-phase log lines (subprocess boot + pollWebDriverStatus) are
    // captured to the file rather than swallowed by the WDIO logger fallback.
    if (mergedOptions.captureBackendLogs || mergedOptions.captureFrontendLogs) {
      if (!isLogWriterInitialized('dioxus-service')) {
        const logDir = _config.outputDir ?? join(process.cwd(), 'logs');
        getLogWriter('dioxus-service').initialize(logDir);
        log.info(`Log capture initialized: ${logDir}`);
      }
    }

    if (provider === 'embedded') {
      const isMultiremote = !Array.isArray(capabilities);
      if (isMultiremote) {
        await this.prepareEmbeddedMultiremote(capabilities as Record<string, { capabilities: DioxusCapabilities }>);
      } else {
        await this.prepareEmbedded(capabilities as DioxusCapabilities[]);
      }
    }
    // provider === 'external': wdio-dioxus-driver spawning wired in a follow-on commit
  }

  private async prepareEmbedded(capsList: DioxusCapabilities[]): Promise<void> {
    const hostname = '127.0.0.1';

    for (let i = 0; i < capsList.length; i++) {
      const cap = capsList[i];
      const instanceOptions = mergeOptions(this.options, cap['wdio:dioxusServiceOptions']);
      const capPort = cap['wdio:dioxusServiceOptions']?.embeddedPort;
      const embeddedPort = capPort != null ? capPort : getEmbeddedPort(instanceOptions) + i;
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

      // Set on the capability itself — wdio run strips these before the W3C session request;
      // standalone session.ts removes them from the cloned capabilities before remote().
      (cap as { port?: number; hostname?: string }).port = embeddedPort;
      (cap as { port?: number; hostname?: string }).hostname = hostname;
      log.info(`Embedded WebDriver connection set on capabilities[${i}]: ${hostname}:${embeddedPort}`);
    }
  }

  private async prepareEmbeddedMultiremote(
    capabilities: Record<string, { capabilities: DioxusCapabilities }>,
  ): Promise<void> {
    const hostname = '127.0.0.1';
    const entries = Object.entries(capabilities);

    for (let i = 0; i < entries.length; i++) {
      const [key, instanceConfig] = entries[i];
      const cap = instanceConfig.capabilities;
      const instanceOptions = mergeOptions(this.options, cap['wdio:dioxusServiceOptions']);
      const capPort = cap['wdio:dioxusServiceOptions']?.embeddedPort;
      const embeddedPort = capPort != null ? capPort : getEmbeddedPort(instanceOptions) + i;
      const appBinaryPath = cap['dioxus:options']?.application ?? instanceOptions.appBinaryPath;

      if (!appBinaryPath) {
        throw new SevereServiceError(
          `Dioxus application path not specified for multiremote instance "${key}". ` +
            "Set 'dioxus:options'.application or appBinaryPath in wdio:dioxusServiceOptions.",
        );
      }

      log.info(`Starting embedded WebDriver for multiremote instance "${key}" on port ${embeddedPort}`);

      try {
        const driverInfo = await startEmbeddedDriver(appBinaryPath, embeddedPort, instanceOptions, key);
        this.embeddedProcesses.set(key, driverInfo);
      } catch (error) {
        await this.stopAllEmbedded();
        throw new SevereServiceError(
          `Failed to start embedded WebDriver for multiremote instance "${key}": ${(error as Error).message}`,
        );
      }

      // For multiremote, port/hostname must be on the outer instance config so WDIO
      // reads them as connection parameters, not as W3C capability keys.
      (instanceConfig as { port?: number; hostname?: string }).port = embeddedPort;
      (instanceConfig as { port?: number; hostname?: string }).hostname = hostname;
      log.info(`Embedded WebDriver connection set for "${key}": ${hostname}:${embeddedPort}`);
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
    await this.#stopDevServer?.();
    this.#stopDevServer = undefined;
    await this.stopAllEmbedded();
    // Stop any external (wdio-dioxus-driver) processes managed by BaseLauncher
    await this.stopAllDrivers();
    // Flush + close the LogWriter (mirrors tauri-service/launcher.ts). Without
    // this, bytes still in the WriteStream buffer at process exit can be
    // silently dropped from the captured log file.
    try {
      await closeLogWriter('dioxus-service');
    } catch (error) {
      log.warn(`Failed to close LogWriter: ${(error as Error).message}`);
    }
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
