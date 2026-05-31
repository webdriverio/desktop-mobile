import { BaseLauncher, closeLogWriter, isLogWriterInitialized } from '@wdio/native-core';
import { createLogger } from '@wdio/native-utils';
import type { Options } from '@wdio/types';

import { DEFAULT_DEBUG_PORT_BASE, SERVICE_NAME } from './constants.js';
import { type ResolvedElectrobunApp, resolveElectrobunApp, verifyCefRenderer } from './electrobunConfig.js';
import { SevereServiceError } from './errors.js';
import { type ElectrobunAppProcess, spawnElectrobunApp, stopElectrobunApp } from './nativeMode.js';
import { getServiceOptionsFromCapability, mergeServiceOptions } from './serviceConfig.js';
import type { ElectrobunCapabilities, ElectrobunServiceGlobalOptions, ElectrobunServiceOptions } from './types.js';

const log = createLogger(SERVICE_NAME, 'launcher');

/**
 * Main-process launcher for `@wdio/electrobun-service`.
 *
 * Electrobun is a CDP-attach framework: the launcher spawns the app binary and
 * the worker attaches over CDP through Chromedriver (`debuggerAddress`). It
 * extends `BaseLauncher` to reuse `@wdio/native-core`'s port/process/log infra.
 *
 * Native-mode flow (parallel-safe):
 *  - `onPrepare`: resolve + CEF-verify each app bundle, force `browserName: 'chrome'`.
 *  - `onWorkerStart`: allocate a port, then spawn the app — the spawn path clones
 *    the bundle per worker, pins the port into the clone's build.json, and uses a
 *    per-run CFFIXED_USER_HOME — and set `goog:chromeOptions.debuggerAddress`.
 *  - `onComplete`: kill spawned apps + clean temp dirs.
 */
export default class ElectrobunLaunchService extends BaseLauncher {
  private browserMode = false;
  /** Resolved app bundle per capability index, set in onPrepare for onWorkerStart. */
  private resolvedApps: ResolvedElectrobunApp[] = [];
  private spawnedApps: ElectrobunAppProcess[] = [];

  constructor(
    private options: ElectrobunServiceGlobalOptions,
    _capabilities: ElectrobunCapabilities,
    _config: Options.Testrunner,
  ) {
    const basePort = options.remoteDebuggingPort ?? DEFAULT_DEBUG_PORT_BASE;
    super({
      basePort,
      // Electrobun is CDP-attach: there is no separate native driver process, so
      // baseNativePort is nominal. Anchored alongside basePort, clear of CEF's
      // [9222, 9232] auto-scan range so PortManager never hands out a port CEF
      // might grab for an un-pinned app.
      baseNativePort: basePort + 1,
    });
    // Don't serialise the full testrunner config/capabilities — they can carry
    // credentials (reporter tokens, cloud keys) that shouldn't land in debug logs.
    log.debug('ElectrobunLaunchService initialised');
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
      this.browserMode = true;
      log.info('Browser mode enabled — skipping Electrobun binary/CDP setup');
      return;
    }

    // Native mode: resolve + CEF-verify each bundle, force chrome capability. The
    // app clone + port pinning + spawn happen in onWorkerStart so each worker gets
    // a freshly allocated port pinned into its own bundle clone.
    this.resolvedApps = [];
    for (const cap of capsList) {
      const instanceOptions = mergeServiceOptions(this.options, getServiceOptionsFromCapability(cap));
      const app = resolveElectrobunApp(instanceOptions.appBinaryPath);
      verifyCefRenderer(app);
      this.resolvedApps.push(app);
      (cap as { browserName?: string }).browserName = 'chrome';
    }
    log.info(`Native mode prepared ${this.resolvedApps.length} Electrobun app(s)`);
  }

  async onWorkerStart(
    cid: string,
    capabilities: ElectrobunCapabilities | ElectrobunCapabilities[] | undefined,
  ): Promise<void> {
    if (this.browserMode) {
      log.debug(`Worker ${cid}: browser mode — skipping app spawn`);
      return;
    }
    if (!capabilities) {
      log.warn(`Worker ${cid}: no capabilities provided, skipping spawn`);
      return;
    }

    const capsList = Array.isArray(capabilities) ? capabilities : [capabilities];

    for (let i = 0; i < capsList.length; i++) {
      const cap = capsList[i];
      // The resolved bundle is the source template; each worker (cid) clones it
      // and pins its own port inside spawnApp, so one resolved app safely drives
      // any number of parallel workers.
      const app = this.resolvedApps[i] ?? this.resolvedApps[0];
      if (!app) {
        throw new SevereServiceError(
          `Worker ${cid}: no resolved Electrobun app for capability ${i}. ` +
            'onPrepare must run before onWorkerStart in native mode.',
        );
      }

      const instanceOptions = mergeServiceOptions(this.options, getServiceOptionsFromCapability(cap));
      const port = await this.portManager.allocatePort(this.options.remoteDebuggingPort ?? DEFAULT_DEBUG_PORT_BASE);

      // The allocated port is pinned into the per-worker bundle clone inside
      // spawnApp — the CEF port is fixed per bundle (a launch arg does NOT work,
      // see RESEARCH_FINDINGS), so the clone is what makes parallel workers safe.
      const spawned = this.spawnApp(app, port, instanceOptions, cid);
      this.spawnedApps.push(spawned);

      const existingChromeOptions = (cap['goog:chromeOptions'] ?? {}) as Record<string, unknown>;
      cap['goog:chromeOptions'] = {
        ...existingChromeOptions,
        debuggerAddress: `localhost:${port}`,
      };
      log.info(`Worker ${cid}: Electrobun app on CDP port ${port} (debuggerAddress set)`);
    }
  }

  // Seam for unit tests to assert spawn wiring without launching a real process.
  protected spawnApp(
    app: ResolvedElectrobunApp,
    port: number,
    options: ElectrobunServiceOptions,
    instanceId?: string,
  ): ElectrobunAppProcess {
    return spawnElectrobunApp({
      app,
      appArgs: options.appArgs ?? [],
      port,
      options,
      instanceId,
    });
  }

  async onComplete(): Promise<void> {
    for (const app of this.spawnedApps) {
      await stopElectrobunApp(app).catch((error: Error) => {
        log.warn(`Failed to stop Electrobun app: ${error.message}`);
      });
    }
    this.spawnedApps = [];

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
