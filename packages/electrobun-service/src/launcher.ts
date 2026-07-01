import {
  BaseLauncher,
  closeLogWriter,
  isLogWriterInitialized,
  probeDevServerReachable,
  startManagedDevServer,
} from '@wdio/native-core';
import { createLogger, isErr } from '@wdio/native-utils';
import type { Options } from '@wdio/types';

import { CUSTOM_CAPABILITY_NAME, DEFAULT_DEBUG_PORT_BASE, SERVICE_NAME } from './constants.js';
import { type ResolvedElectrobunApp, resolveElectrobunApp, verifyCefRenderer } from './electrobunConfig.js';
import { nativeRendererUnsupportedPlatform, SevereServiceError } from './errors.js';
import { type ElectrobunAppProcess, spawnElectrobunApp, stopElectrobunApp, waitForCdpReady } from './nativeMode.js';
import { getServiceOptionsFromCapability, mergeServiceOptions } from './serviceConfig.js';
import { resolveTransport } from './transport.js';
import type { ElectrobunCapabilities, ElectrobunServiceGlobalOptions, ElectrobunServiceOptions } from './types.js';
import { detectWebView2RuntimeVersion } from './webview2Version.js';

const log = createLogger(SERVICE_NAME, 'launcher');

/**
 * Main-process launcher for `@wdio/electrobun-service`.
 *
 * Electrobun is a CDP-attach framework: the launcher spawns the app binary and the worker
 * attaches over CDP via `debuggerAddress`. It extends `BaseLauncher` to reuse
 * `@wdio/native-core`'s port/process/log infra. The CDP transport is per platform
 * (see `resolveTransport`):
 *  - **macOS → CEF** (Chromium), driven by **chromedriver** (`browserName: 'chrome'`,
 *    `goog:chromeOptions.debuggerAddress`). Single-instance (`maxInstances=1`): CEF can't
 *    isolate the forced `persist:default` profile per worker, so we do NOT redirect the cache
 *    root (no `CFFIXED_USER_HOME`, no per-worker `--user-data-dir`) — CEF uses its own
 *    `root_cache_path`.
 *  - **Windows → native WebView2** (Edge-based Chromium), driven by **msedgedriver**
 *    (`browserName: 'MicrosoftEdge'`, `ms:edgeOptions.debuggerAddress`). Isolates per instance
 *    (its own `LOCALAPPDATA` data root), so parallel workers + multiremote work.
 *  - **Linux** has no CDP/automation surface yet → unsupported (fail fast). See the
 *    implementation plan "Framework gaps".
 *
 * Native-mode flow:
 *  - `onPrepare`: resolve each bundle + pick its transport; CEF-verify (CEF only); force
 *    `browserName`; pin the driver to the WebView2 runtime version (WebView2 only).
 *  - `onWorkerStart`: allocate a port; spawn the app — CEF clones the bundle and pins the port
 *    into the clone's `build.json`, WebView2 injects `--remote-debugging-port` via env — wait
 *    for `/json`, then set the `debuggerAddress`.
 *  - `onComplete`: kill spawned apps + clean temp dirs.
 */
export default class ElectrobunLaunchService extends BaseLauncher {
  private browserMode = false;
  // Teardown for a service-managed dev server (browser mode). Called from onComplete AND on an
  // onPrepare failure — WDIO does not call onComplete after onPrepare throws. Idempotent.
  #stopDevServer?: () => Promise<void>;
  /** Resolved app bundle per capability index, set in onPrepare for onWorkerStart. */
  private resolvedApps: ResolvedElectrobunApp[] = [];
  /**
   * Spawned apps keyed by worker cid. Torn down per-spec in onWorkerEnd so apps
   * don't accumulate across a run — multiple live CEF instances contend (profile
   * creation / resources) even when specs run serially. onComplete sweeps any
   * stragglers (e.g. a worker that never reported end).
   */
  private spawnedAppsByCid = new Map<string, ElectrobunAppProcess[]>();

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
    config: Options.Testrunner,
    capabilities: ElectrobunCapabilities[] | Record<string, { capabilities: ElectrobunCapabilities }>,
  ): Promise<void> {
    const capsList = normaliseCaps(capabilities);

    // Reject a mixed browser-mode + native-mode capability set: this launcher
    // applies one mode to all caps (browser mode forces browserName:'chrome' on
    // every cap and skips setup; native mode spawns a binary per cap). Silently
    // treating a native cap as browser (or vice-versa) because a sibling cap set
    // the other mode would be a confusing footgun — fail fast on a consistent mode.
    const modes = capsList.map((cap) => mergeServiceOptions(this.options, getServiceOptionsFromCapability(cap)).mode);
    if (modes.some((mode) => mode === 'browser') && modes.some((mode) => mode !== 'browser')) {
      throw new SevereServiceError(
        'Mixed browser-mode and native-mode Electrobun capabilities in a single run are not supported. ' +
          'Set `mode` consistently across all capabilities (all "browser", or all native).',
      );
    }

    // Detect browser mode even when set on a non-first capability.
    const primaryCap =
      capsList.find(
        (cap) => mergeServiceOptions(this.options, getServiceOptionsFromCapability(cap)).mode === 'browser',
      ) ?? capsList[0];
    const mergedOptions = mergeServiceOptions(this.options, getServiceOptionsFromCapability(primaryCap));

    // Browser mode: skip all binary/CDP setup — the frontend runs against a dev
    // server in a plain Chrome session.
    if (mergedOptions.mode === 'browser') {
      let devServerUrl = mergedOptions.devServerUrl;
      // Everything from the dev-server start onward runs in one guard: any failure after the server
      // is up must stop it, because WDIO does not call onComplete after an onPrepare throw.
      try {
        // Auto-manage the dev server if requested; the managed readiness wait supersedes the
        // one-shot preflight below, and a devServer function may supply the URL.
        if (mergedOptions.devServer) {
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
            throw new SevereServiceError(reachable.error.message);
          }
        }
        for (const cap of capsList) {
          (cap as { browserName?: string }).browserName = 'chrome';
          // Propagate the resolved URL (a devServer function may have overridden it) to the worker,
          // which reads devServerUrl from its capability options.
          const capRecord = cap as Record<string, unknown>;
          capRecord[CUSTOM_CAPABILITY_NAME] = {
            ...(capRecord[CUSTOM_CAPABILITY_NAME] as Record<string, unknown> | undefined),
            devServerUrl,
          };
        }
      } catch (error) {
        // Guard the teardown so a stop() rejection can't mask the original onPrepare failure.
        await this.#stopDevServer?.().catch(() => {});
        this.#stopDevServer = undefined;
        throw error instanceof SevereServiceError
          ? error
          : new SevereServiceError(`Failed to start dev server: ${(error as Error).message}`);
      }
      this.browserMode = true;
      log.info('Browser mode enabled — skipping Electrobun binary/CDP setup');
      return;
    }

    // Native renderer automation covers macOS (CEF) and Windows (WebView2 over CDP).
    // Linux's WebKitGTK exposes no CDP/automation surface yet, and CEF-on-Linux serves no
    // /json — fail fast here, before touching the bundle, rather than let the user hit a
    // cryptic CDP-attach timeout. Browser mode is unaffected — it already returned above.
    // The per-app renderer→transport decision (and the CEF-on-Windows rejection) happens in
    // the resolve loop below.
    if (process.platform !== 'darwin' && process.platform !== 'win32') {
      throw nativeRendererUnsupportedPlatform(process.platform);
    }

    // CEF (macOS) can't isolate ≥2 app instances (shared root_cache_path → instance folding;
    // upstream-blocked, #320), so parallel workers race there. WebView2 (Windows) isolates
    // each instance (its own LOCALAPPDATA data root), so parallel workers + multiremote work —
    // only warn on macOS. WDIO's default maxInstances is 100, so this can't be a hard error.
    if (process.platform === 'darwin' && (config.maxInstances ?? 1) > 1) {
      log.warn(
        `maxInstances is ${config.maxInstances}, but Electrobun CEF on macOS is single-instance: parallel ` +
          'workers share one CEF cache root and race ("Cannot create profile" / CDP timeouts). Pin maxInstances: 1.',
      );
    }

    // Native mode: resolve each bundle, pick its CDP transport, force chrome capability.
    // The spawn (CEF clone+port-pin, or WebView2 env-var injection) happens in
    // onWorkerStart so each worker gets a freshly allocated port.
    // WebView2 (Windows) only: detect the installed runtime version once so the loop can pin
    // msedgedriver to it (see the per-cap note below). Off Windows this is skipped.
    const webview2Version = process.platform === 'win32' ? detectWebView2RuntimeVersion() : undefined;
    let warnedNoWebView2Version = false;
    this.resolvedApps = [];
    for (const cap of capsList) {
      const instanceOptions = mergeServiceOptions(this.options, getServiceOptionsFromCapability(cap));
      const app = resolveElectrobunApp(instanceOptions.appBinaryPath);
      const transport = resolveTransport(app);
      if (!transport) {
        // e.g. a CEF-built bundle on Windows — CEF serves no /json there.
        throw nativeRendererUnsupportedPlatform(process.platform, app.renderer);
      }
      // CEF needs the framework/renderer check; WebView2 (Chromium) always serves /json
      // once the launcher injects --remote-debugging-port, so there's nothing to verify.
      if (transport === 'cef') {
        verifyCefRenderer(app);
      }
      this.resolvedApps.push(app);
      // CEF is plain Chromium → chromedriver. WebView2 is Edge (it reports `Edg/<ver>`,
      // which chromedriver rejects as an "unrecognized Chrome version"), so it must be
      // driven by msedgedriver → browserName 'MicrosoftEdge' (WDIO provisions edgedriver).
      (cap as { browserName?: string }).browserName = transport === 'webview2' ? 'MicrosoftEdge' : 'chrome';
      // The WebView2 runtime can lag the Edge browser WDIO auto-matches; a mismatched
      // msedgedriver then refuses to attach ("only supports Microsoft Edge version N"). Pin the
      // driver to the runtime version instead, respecting any user-set browserVersion. If the
      // runtime version couldn't be detected, warn once so the at-risk auto-match is traceable.
      if (transport === 'webview2') {
        const versioned = cap as { browserVersion?: string };
        if (webview2Version) {
          versioned.browserVersion ??= webview2Version;
        } else if (versioned.browserVersion === undefined && !warnedNoWebView2Version) {
          // Only warn when we'd actually fall back to auto-match — not when the user pinned
          // browserVersion themselves (then there's no fallback and nothing at risk).
          warnedNoWebView2Version = true;
          log.warn(
            "Could not detect the installed WebView2 runtime version — falling back to WDIO's " +
              'Edge-browser driver auto-match. If the runtime lags the Edge browser, msedgedriver may ' +
              'refuse to attach ("session not created: only supports Microsoft Edge version N").',
          );
        }
      }
    }
    log.info(`Native mode prepared ${this.resolvedApps.length} Electrobun app(s)`);
  }

  async onWorkerStart(
    cid: string,
    capabilities:
      | ElectrobunCapabilities
      | ElectrobunCapabilities[]
      | Record<string, { capabilities: ElectrobunCapabilities }>
      | undefined,
  ): Promise<void> {
    if (this.browserMode) {
      log.debug(`Worker ${cid}: browser mode — skipping app spawn`);
      return;
    }
    if (!capabilities) {
      log.warn(`Worker ${cid}: no capabilities provided, skipping spawn`);
      return;
    }

    const capsList = normaliseWorkerCaps(capabilities);
    const workerApps: ElectrobunAppProcess[] = [];

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
      workerApps.push(spawned);

      // 127.0.0.1, not 'localhost': the renderer binds the debugger on IPv4, but Node/
      // the driver resolve 'localhost' to IPv6 ::1 first on Windows/Linux CI → the attach
      // (and the /json poll below) fail. The bridge inherits this host via
      // parseDebuggerAddress, so it connects on IPv4 too. WebView2 is Edge: msedgedriver
      // reads debuggerAddress from `ms:edgeOptions`, whereas CEF/chromedriver uses
      // `goog:chromeOptions`.
      const debuggerAddress = `127.0.0.1:${port}`;
      if (resolveTransport(app) === 'webview2') {
        // `ms:edgeOptions` isn't on the narrowed ElectrobunCapabilities type — index via a record.
        const edgeCap = cap as Record<string, unknown>;
        const existingEdgeOptions = (edgeCap['ms:edgeOptions'] ?? {}) as Record<string, unknown>;
        edgeCap['ms:edgeOptions'] = { ...existingEdgeOptions, debuggerAddress };
      } else {
        const existingChromeOptions = (cap['goog:chromeOptions'] ?? {}) as Record<string, unknown>;
        cap['goog:chromeOptions'] = { ...existingChromeOptions, debuggerAddress };
      }

      // Wait for CEF to actually serve /json with a page target before the worker's
      // Chromedriver attaches to debuggerAddress — otherwise it races the (slow on
      // Windows) port binding and the session times out. Track the app for teardown
      // first so a wait failure still cleans up.
      this.spawnedAppsByCid.set(cid, workerApps);
      await waitForCdpReady(port);
      log.info(`Worker ${cid}: Electrobun app on CDP port ${port} (debuggerAddress set, CDP ready)`);
    }
  }

  /** Tear down this worker's app(s) when its spec finishes, so they don't accumulate. */
  async onWorkerEnd(cid: string): Promise<void> {
    const apps = this.spawnedAppsByCid.get(cid);
    if (!apps) {
      return;
    }
    this.spawnedAppsByCid.delete(cid);
    for (const app of apps) {
      await stopElectrobunApp(app).catch((error: Error) => {
        log.warn(`Worker ${cid}: failed to stop Electrobun app: ${error.message}`);
      });
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
    await this.#stopDevServer?.();
    this.#stopDevServer = undefined;
    for (const apps of this.spawnedAppsByCid.values()) {
      for (const app of apps) {
        await stopElectrobunApp(app).catch((error: Error) => {
          log.warn(`Failed to stop Electrobun app: ${error.message}`);
        });
      }
    }
    this.spawnedAppsByCid.clear();

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

/**
 * Normalise the capabilities `onWorkerStart` receives into a flat per-instance list. For a
 * multiremote run WDIO passes the `{ instanceName: { capabilities } }` record; for a standard
 * run it's an array (or a lone cap object). Extracting the record's per-instance caps — by
 * reference, so the `debuggerAddress` set on each below reaches WDIO — is what lets multiremote
 * spawn one app per instance instead of mistaking the whole record for a single cap.
 */
function normaliseWorkerCaps(
  capabilities:
    | ElectrobunCapabilities
    | ElectrobunCapabilities[]
    | Record<string, { capabilities: ElectrobunCapabilities }>,
): ElectrobunCapabilities[] {
  if (Array.isArray(capabilities)) {
    return capabilities;
  }
  const values = Object.values(capabilities);
  if (values.length > 0 && values.every((v) => v != null && typeof v === 'object' && 'capabilities' in v)) {
    return (values as Array<{ capabilities: ElectrobunCapabilities }>).map((entry) => entry.capabilities);
  }
  return [capabilities as ElectrobunCapabilities];
}
