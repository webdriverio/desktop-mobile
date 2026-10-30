import { join } from 'node:path';

import {
  BaseLauncher,
  closeLogWriter,
  getLogWriter,
  isLogWriterInitialized,
  nonChromeBrowserNameError,
  normaliseInstanceCaps,
  probeDevServerReachable,
  startManagedDevServer,
} from '@wdio/native-core';
import { createLogger, errorMessage, isErr, severeServiceError } from '@wdio/native-utils';
import type { Options } from '@wdio/types';
import { SevereServiceError } from 'webdriverio';

import {
  linuxExternalProviderUnsupported,
  macosExternalProviderUnsupported,
  windowsExternalProviderUnsupported,
} from './errors.js';
import {
  type EmbeddedDriverInfo,
  getEmbeddedPort,
  startEmbeddedDriver,
  stopEmbeddedDriver,
} from './providers/embedded.js';
import { mergeOptions } from './serviceConfig.js';
import type { DioxusCapabilities, DioxusServiceGlobalOptions, DioxusServiceOptions } from './types.js';

const log = createLogger('dioxus-service', 'launcher');

export default class DioxusLaunchService extends BaseLauncher {
  private embeddedProcesses: Map<string, EmbeddedDriverInfo> = new Map();
  // Teardown for a service-managed dev server (browser mode). Called from onComplete AND on an
  // onPrepare failure — WDIO does not call onComplete after onPrepare throws. Idempotent.
  #stopDevServer?: () => Promise<void>;
  #browserMode = false;

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

  get isBrowserMode(): boolean {
    return this.#browserMode;
  }

  async onPrepare(
    _config: Options.Testrunner,
    capabilities: DioxusCapabilities[] | Record<string, { capabilities: DioxusCapabilities }>,
  ): Promise<void> {
    const capsList = normaliseInstanceCaps(capabilities).map(({ caps }) => caps);
    // Use the first capability with mode='browser' as the options source so that
    // browser mode is detected even when set on a non-first capability.
    const primaryCap =
      capsList.find((cap) => mergeOptions(this.options, cap['wdio:dioxusServiceOptions']).mode === 'browser') ??
      capsList[0];
    const mergedOptions = mergeOptions(this.options, primaryCap?.['wdio:dioxusServiceOptions']);

    // Browser mode: skip all binary/driver setup — test runs against a Vite dev server
    if (mergedOptions.mode === 'browser') {
      // Reject a non-chrome browserName up front — before starting anything — so a misconfig fails
      // fast and can never orphan a managed dev server.
      for (const cap of capsList) {
        const browserNameError = nonChromeBrowserNameError((cap as { browserName?: string }).browserName, [
          'chrome',
          'dioxus',
        ]);
        if (browserNameError) {
          throw new SevereServiceError(browserNameError);
        }
      }
      let devServerUrl = mergedOptions.devServerUrl;
      // Everything from the dev-server start onward runs in one guard: any failure after the server
      // is up must stop it, because WDIO does not call onComplete after an onPrepare throw.
      try {
        // Auto-manage the dev server if requested; the managed readiness wait supersedes the
        // one-shot preflight below, and a devServer function may supply the URL.
        if (mergedOptions.devServer) {
          // Only a devServer *function* can supply the URL; a string/object form needs devServerUrl
          // as its readiness target. Require it up front so a missing one fails fast instead of
          // polling an empty URL for the whole readiness timeout.
          if (typeof mergedOptions.devServer !== 'function' && !devServerUrl) {
            throw new SevereServiceError(
              'devServerUrl is required when mode is "browser" (set it, or return a url from a devServer function)',
            );
          }
          const managed = await startManagedDevServer(mergedOptions.devServer, devServerUrl ?? '');
          this.#stopDevServer = managed.stop;
          devServerUrl = managed.url || devServerUrl;
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
        if (!mergedOptions.devServer) {
          // Unmanaged: preflight the user-started server before workers navigate to it.
          const reachable = await probeDevServerReachable(devServerUrl);
          if (isErr(reachable)) {
            throw severeServiceError(reachable.error);
          }
        }
        this.#browserMode = true;
        for (const cap of capsList) {
          (cap as { browserName?: string }).browserName = 'chrome';
          delete (cap as { 'dioxus:options'?: unknown })['dioxus:options'];
          // The worker reads mode and devServerUrl from here; a devServer function may have changed the URL.
          const capRecord = cap as Record<string, unknown>;
          capRecord['wdio:dioxusServiceOptions'] = {
            ...(capRecord['wdio:dioxusServiceOptions'] as Record<string, unknown> | undefined),
            mode: 'browser',
            devServerUrl,
          };
        }
      } catch (error) {
        // Guard the teardown so a stop() rejection can't mask the original onPrepare failure.
        await this.#stopDevServer?.().catch(() => {});
        this.#stopDevServer = undefined;
        throw error instanceof SevereServiceError ? error : severeServiceError('Failed to start dev server', error);
      }
      log.info('Browser mode enabled — skipping driver/binary setup');
      return;
    }

    const provider = mergedOptions.driverProvider ?? 'embedded';

    if (provider === 'external') {
      if (process.platform === 'linux') {
        throw linuxExternalProviderUnsupported();
      }
      if (process.platform === 'darwin') {
        throw macosExternalProviderUnsupported();
      }
      throw windowsExternalProviderUnsupported();
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
      await this.prepareEmbedded(capabilities);
    }
  }

  private async prepareEmbedded(
    capabilities: DioxusCapabilities[] | Record<string, { capabilities: DioxusCapabilities }>,
  ): Promise<void> {
    const hostname = '127.0.0.1';
    const instances = normaliseInstanceCaps(capabilities);

    for (let i = 0; i < instances.length; i++) {
      const { name, caps: cap, connectionTarget } = instances[i];
      const instanceLabel = name === undefined ? `instance ${i}` : `multiremote instance "${name}"`;
      // WDIO does not call onComplete after an onPrepare throw, so reap already-spawned drivers in
      // the catch — otherwise a later instance's failure orphans the earlier ones.
      try {
        const instanceOptions = mergeOptions(this.options, cap['wdio:dioxusServiceOptions']);
        const instancePort = cap['wdio:dioxusServiceOptions']?.embeddedPort;
        const embeddedPort = await this.portManager.allocatePort(instancePort ?? getEmbeddedPort(instanceOptions) + i);
        const appBinaryPath = cap['dioxus:options']?.application ?? instanceOptions.appBinaryPath;

        if (!appBinaryPath) {
          throw new SevereServiceError(
            `Dioxus application path not specified${name === undefined ? '' : ` for ${instanceLabel}`}. ` +
              "Set 'dioxus:options'.application or appBinaryPath in wdio:dioxusServiceOptions.",
          );
        }

        log.info(`Starting embedded WebDriver for ${instanceLabel} on port ${embeddedPort}`);

        const instanceId = name ?? String(i);
        const driverInfo = await startEmbeddedDriver(appBinaryPath, embeddedPort, instanceOptions, instanceId);
        this.embeddedProcesses.set(instanceId, driverInfo);

        connectionTarget.port = embeddedPort;
        connectionTarget.hostname = hostname;
        applyWindowLabel(cap, instanceOptions);
        log.info(`Embedded WebDriver connection set for ${instanceLabel}: ${hostname}:${embeddedPort}`);
      } catch (error) {
        await this.stopAllEmbedded();
        throw error instanceof SevereServiceError
          ? error
          : severeServiceError(`Failed to start embedded WebDriver for ${instanceLabel}`, error);
      }
    }
  }

  private async stopAllEmbedded(): Promise<void> {
    for (const [id, info] of this.embeddedProcesses) {
      log.info(`Stopping embedded driver instance ${id}`);
      await stopEmbeddedDriver(info).catch((err) => {
        log.warn(`Error stopping embedded driver ${id}: ${errorMessage(err)}`);
      });
    }
    this.embeddedProcesses.clear();
  }

  async onComplete(): Promise<void> {
    try {
      await this.#stopDevServer?.();
      this.#stopDevServer = undefined;
      await this.stopAllEmbedded();
      await this.stopAllDrivers();
    } finally {
      try {
        await closeLogWriter('dioxus-service');
      } catch (error) {
        log.warn(`Failed to close LogWriter: ${errorMessage(error)}`);
      }
    }
  }
}

// The embedded driver reads windowLabel only from the capability.
function applyWindowLabel(cap: DioxusCapabilities, instanceOptions: DioxusServiceOptions): void {
  if (instanceOptions.windowLabel === undefined) {
    return;
  }
  cap['wdio:dioxusServiceOptions'] = { ...cap['wdio:dioxusServiceOptions'], windowLabel: instanceOptions.windowLabel };
}
