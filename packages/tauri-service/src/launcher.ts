import type { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nonChromeBrowserNameError, probeDevServerReachable, startManagedDevServer } from '@wdio/native-core';
import type { LogLevel } from '@wdio/native-types';
import { createLogger, formatDiagnosticResults, isErr } from '@wdio/native-utils';
import type { Options } from '@wdio/types';
import { SevereServiceError } from 'webdriverio';
import { resolveAppBinaryPath } from './appBinaryResolver.js';
import { setCrabnebulaModeInfo, setEmbeddedModeInfo } from './commands/triggerDeeplink.js';
import { startTestRunnerBackend, stopTestRunnerBackend, waitTestRunnerBackendReady } from './crabnebulaBackend.js';
import { diagnoseTauriEnvironment } from './diagnostics.js';
import { ensureTauriDriver, findTestRunnerBackend } from './driverManager.js';
import { DriverPool } from './driverPool.js';
import { ensureMsEdgeDriver } from './edgeDriverManager.js';
import {
  checkEmbeddedServerAlive,
  type EmbeddedDriverInfo,
  getEmbeddedPort,
  isEmbeddedProvider,
  startEmbeddedDriver,
  stopEmbeddedDriver,
} from './embeddedProvider.js';
import { getWebKitWebDriverPath } from './pathResolver.js';
import { PortManager } from './portManager.js';
import type { DriverProvider, TauriCapabilities, TauriServiceGlobalOptions, TauriServiceOptions } from './types.js';

const log = createLogger('tauri-service', 'launcher');

/**
 * Generate unique data directory for multiremote instance or worker
 */
function generateDataDirectory(instanceId: string): string {
  const baseTempDir = tmpdir();
  // Support both multiremote instances and worker IDs
  const prefix = instanceId.startsWith('worker-') ? 'tauri' : 'tauri-multiremote';
  const dataDir = join(baseTempDir, `${prefix}-${instanceId}`);

  log.debug(`Generated data directory for ${instanceId}: ${dataDir}`);
  return dataDir;
}

// (per-instance env is set when spawning the tauri-driver process)

let officialDeprecationWarned = false;

/**
 * Normalise legacy `driverProvider: 'official'` to the canonical `'external'`.
 * Emits a one-time deprecation warning. `'official'` will be removed in v2.
 */
function normaliseDriverProvider(value: DriverProvider | undefined): DriverProvider | undefined {
  if (value === 'official') {
    if (!officialDeprecationWarned) {
      log.warn(
        "driverProvider: 'official' is deprecated; use 'external' instead. " +
          "The 'official' value will be removed in @wdio/tauri-service v2.",
      );
      officialDeprecationWarned = true;
    }
    return 'external';
  }
  return value;
}

/**
 * Merge global options with capability-specific options
 */
function mergeOptions(
  globalOptions: TauriServiceGlobalOptions,
  capabilityOptions?: TauriServiceOptions,
): TauriServiceOptions {
  return {
    ...globalOptions,
    ...capabilityOptions,
    driverProvider: normaliseDriverProvider(capabilityOptions?.driverProvider ?? globalOptions.driverProvider),
    // Log capture options default to false if not specified
    captureBackendLogs: capabilityOptions?.captureBackendLogs ?? globalOptions.captureBackendLogs ?? false,
    captureFrontendLogs: capabilityOptions?.captureFrontendLogs ?? globalOptions.captureFrontendLogs ?? false,
    backendLogLevel: (capabilityOptions?.backendLogLevel ?? globalOptions.backendLogLevel ?? 'info') as LogLevel,
    frontendLogLevel: (capabilityOptions?.frontendLogLevel ?? globalOptions.frontendLogLevel ?? 'info') as LogLevel,
  };
}

/**
 * Options for setting up readline-based log handling
 */
/**
 * Tauri launcher service
 */
export default class TauriLaunchService {
  private testRunnerBackend?: ChildProcess;
  private appBinaryPath?: string;
  private instanceOptions: Map<string, TauriServiceOptions> = new Map();
  private perWorkerMode: boolean = false;
  private portManager: PortManager;
  private backendPortManager: PortManager;
  private driverPool: DriverPool;
  private browserMode: boolean = false;
  // Teardown for a service-managed dev server (browser mode). Called from onComplete AND on an
  // onPrepare failure — WDIO does not call onComplete after onPrepare throws. Idempotent.
  #stopDevServer?: () => Promise<void>;
  private embeddedProcesses: Map<string, EmbeddedDriverInfo> = new Map();
  private embeddedConfigs: Map<string, { appBinaryPath: string; port: number; options: TauriServiceOptions }> =
    new Map();
  private isEmbeddedMode: boolean = false;
  private workerBackends: Map<string, { proc: ChildProcess; port: number }> = new Map();
  private cnCycleConfigs?: Array<{
    instanceId: string;
    backendPort: number;
    driverPort: number;
    driverNativePort: number;
    env: NodeJS.ProcessEnv;
    options: TauriServiceOptions;
  }>;

  constructor(
    private options: TauriServiceGlobalOptions,
    capabilities: TauriCapabilities,
    config: Options.Testrunner,
  ) {
    log.debug('TauriLaunchService initialized');
    log.debug('Capabilities:', JSON.stringify(capabilities, null, 2));
    log.debug('Config:', JSON.stringify(config, null, 2));

    const basePort = options.tauriDriverPort || 4444;
    this.portManager = new PortManager(basePort, 4445);
    this.backendPortManager = new PortManager(options.crabnebulaBackendPort ?? 3000, 3001);
    this.driverPool = new DriverPool(options, options.nativeDriverPath || getWebKitWebDriverPath());
  }

  /**
   * Prepare the Tauri service
   */
  async onPrepare(
    _config: Options.Testrunner,
    capabilities: TauriCapabilities[] | Record<string, { capabilities: TauriCapabilities }>,
  ): Promise<void> {
    log.debug('Preparing Tauri service...');

    // Determine provider type
    const firstCap = Array.isArray(capabilities) ? capabilities[0] : Object.values(capabilities)[0]?.capabilities;
    const mergedOptions = mergeOptions(this.options, firstCap?.['wdio:tauriServiceOptions']);
    const isCrabNebula = mergedOptions.driverProvider === 'crabnebula';
    const isEmbedded = isEmbeddedProvider(mergedOptions);

    if (isEmbedded && !mergedOptions.driverProvider) {
      log.info(
        `No driverProvider configured — defaulting to embedded WebDriver provider (port ${getEmbeddedPort(mergedOptions)}). ` +
          `Set driverProvider: 'external' to use tauri-driver instead.`,
      );
    }

    // For CrabNebula on macOS, validate prerequisites and set mode info
    if (process.platform === 'darwin' && isCrabNebula) {
      await this.validateCrabNebulaPrerequisites(mergedOptions);
      setCrabnebulaModeInfo(true);
    }

    // Handle both standard array and multiremote object capabilities
    const capsList = Array.isArray(capabilities)
      ? capabilities
      : Object.values(capabilities).map((multiremoteOption) => multiremoteOption.capabilities);

    // Browser mode: skip all driver/binary setup — worker navigates to a Vite dev server
    if (mergedOptions.mode === 'browser') {
      // Reject a non-chrome browserName up front — before starting anything — so a misconfig fails
      // fast and can never orphan a managed dev server.
      for (const cap of capsList) {
        const browserNameError = nonChromeBrowserNameError((cap as { browserName?: string }).browserName, [
          'chrome',
          'tauri',
          'wry',
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
            throw new SevereServiceError(reachable.error.message);
          }
        }
        this.browserMode = true;
        for (const cap of capsList) {
          (cap as { browserName?: string }).browserName = 'chrome';
          delete (cap as { 'tauri:options'?: unknown })['tauri:options'];
          // Propagate the resolved URL (a devServer function may have overridden it) to the worker,
          // which reads devServerUrl from its capability options.
          const capRecord = cap as Record<string, unknown>;
          capRecord['wdio:tauriServiceOptions'] = {
            ...(capRecord['wdio:tauriServiceOptions'] as Record<string, unknown> | undefined),
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
      log.info('Browser mode enabled — skipping driver/binary setup');
      return;
    }

    // Validate capabilities and resolve each one's app binary.
    let firstResolvedBinaryPath: string | undefined;
    for (const cap of capsList) {
      // Validate that browserName is either not set, 'tauri', or 'wry'
      if (cap.browserName && cap.browserName !== 'tauri' && cap.browserName !== 'wry') {
        throw new Error(`Tauri service only supports 'tauri' or 'wry' browserName, got: ${cap.browserName}`);
      }

      // Remove browserName from capabilities before session creation
      // tauri-driver doesn't need it and will reject it during capability matching
      delete (cap as { browserName?: string }).browserName;

      // Resolve the Tauri app binary path. Precedence:
      //   1. tauri:options.application (capability-level)
      //   2. wdio:tauriServiceOptions.appBinaryPath (service-level)
      // If the capability-level application already points at a built
      // artefact, trust it (supports Cargo workspace layouts and release
      // builds the legacy resolver doesn't understand). See appBinaryResolver.ts.
      const instanceOptions = mergeOptions(this.options, cap['wdio:tauriServiceOptions']);
      if (!cap['tauri:options']) {
        cap['tauri:options'] = { application: '' };
      }
      const tauriOptions = cap['tauri:options'];
      const appBinaryPath = resolveAppBinaryPath(instanceOptions, tauriOptions);
      log.debug(`App binary: ${appBinaryPath}`);

      tauriOptions.application = appBinaryPath;
      if (firstResolvedBinaryPath === undefined) {
        firstResolvedBinaryPath = appBinaryPath;
      }

      // Validate app args if provided
      const appArgs = tauriOptions.args || [];
      if (appArgs.length > 0) {
        log.debug(`App args: ${JSON.stringify(appArgs)}`);
      }
    }

    // Ensure Edge WebDriver compatibility on Windows — once, after all caps are
    // resolved. msedgedriver is a single machine-global driver, so one check
    // (matched to the first resolved binary) covers every instance. Keep this
    // outside the resolution loop: a break here would skip the remaining caps.
    if (process.platform === 'win32' && firstResolvedBinaryPath !== undefined) {
      const autoDownloadEdgeDriver = this.options.autoDownloadEdgeDriver ?? true;
      log.debug('Checking Edge WebDriver compatibility...');
      const edgeDriverResult = await ensureMsEdgeDriver(firstResolvedBinaryPath, autoDownloadEdgeDriver);

      if (isErr(edgeDriverResult)) {
        const errorMsg = edgeDriverResult.error.message;
        log.error(`Edge WebDriver check failed: ${errorMsg}`);

        if (!autoDownloadEdgeDriver) {
          throw new Error(
            `${errorMsg}\n` +
              `To auto-fix: set autoDownloadEdgeDriver: true in tauri service options.\n` +
              `Or manually download from: https://developer.microsoft.com/en-us/microsoft-edge/tools/webdriver/`,
          );
        } else {
          log.warn(`${errorMsg} - continuing anyway, test may fail with version mismatch`);
        }
      } else if (edgeDriverResult.value.method === 'downloaded') {
        log.info(
          `✅ Downloaded msedgedriver ${edgeDriverResult.value.driverVersion} for WebView2 ${edgeDriverResult.value.edgeVersion}`,
        );
      } else if (edgeDriverResult.value.method === 'found') {
        log.info(`✅ Using existing msedgedriver ${edgeDriverResult.value.driverVersion}`);
      }
    }

    // For embedded provider: skip tauri-driver installation
    // For official/crabnebula: ensure tauri-driver is installed
    if (!isEmbedded) {
      // Ensure tauri-driver is installed before any workers start.
      // This prevents a race condition where parallel workers all try to
      // cargo-install tauri-driver simultaneously, causing "Access is denied" errors on Windows.
      const driverResult = await ensureTauriDriver(mergedOptions);
      if (isErr(driverResult)) {
        throw driverResult.error;
      }
      log.info(`tauri-driver ready: ${driverResult.value.path} (${driverResult.value.method})`);
    } else {
      log.info('Using embedded WebDriver provider (tauri-plugin-wdio-webdriver) - no external driver needed');
      // Store embedded mode info globally for triggerDeeplink
      setEmbeddedModeInfo(true, undefined);
    }

    // Initialize file log writer if log capture is enabled
    // Uses WDIO's outputDir config option for log file location
    if (mergedOptions.captureBackendLogs || mergedOptions.captureFrontendLogs) {
      try {
        const { getLogWriter, isLogWriterInitialized } = await import('./logWriter.js');
        if (isLogWriterInitialized()) {
          log.debug('Log writer already initialized, skipping re-initialization');
        } else {
          const logDir = _config.outputDir || join(process.cwd(), 'logs');
          getLogWriter().initialize(logDir);
          log.info(`Log capture initialized: ${logDir}`);
        }
      } catch (error) {
        log.warn(`Failed to initialize log writer, logs will go to stdout: ${error}`);
      }
    }

    // Auto-detect per-worker mode based on maxInstances
    // When maxInstances > 1, enable per-worker spawning for parallelism
    // When maxInstances === 1, use single shared driver for optimal performance
    const maxInstances = _config.maxInstances || 100; // WDIO default is 100
    const isMultiremote = !Array.isArray(capabilities);
    this.perWorkerMode = maxInstances > 1 && !isMultiremote;

    log.debug(
      `Per-worker mode: ${this.perWorkerMode ? 'enabled' : 'disabled'} (maxInstances=${maxInstances}, multiremote=${isMultiremote})`,
    );

    // Start shared test-runner-backend for CrabNebula on macOS (single-driver mode only)
    // In per-worker mode, each worker spawns its own backend in onWorkerStart()
    // Skip for multiremote - we spawn one backend per instance in the multiremote block below
    if (process.platform === 'darwin' && isCrabNebula && !this.perWorkerMode && !isMultiremote) {
      const manageBackend = mergedOptions.crabnebulaManageBackend ?? true;
      if (manageBackend) {
        const backendPort = mergedOptions.crabnebulaBackendPort ?? 3000;
        // Allocate port to prevent collision with worker backends
        await this.backendPortManager.allocatePortPair(backendPort, backendPort + 1);
        const { proc } = await startTestRunnerBackend({ port: backendPort, serviceOptions: mergedOptions });
        await waitTestRunnerBackendReady('127.0.0.1', backendPort, 30000);

        this.testRunnerBackend = proc;

        // Set environment variable for tauri-driver
        process.env.REMOTE_WEBDRIVER_URL = `http://127.0.0.1:${backendPort}`;
        log.info(`CrabNebula backend ready on port ${backendPort}`);
      }
    }

    // Multiremote: spawn a dedicated driver per instance on unique ports
    if (isMultiremote) {
      const capEntries = Object.entries(capabilities);

      if (isEmbedded) {
        // Embedded provider: spawn each app with unique embedded ports
        this.isEmbeddedMode = true;
        // Store embedded mode info globally for triggerDeeplink
        setEmbeddedModeInfo(true, undefined);
        log.info(`Starting ${capEntries.length} embedded WebDriver instance(s) for multiremote`);

        const hostname = '127.0.0.1';
        const basePort = getEmbeddedPort(mergedOptions);

        for (let i = 0; i < capEntries.length; i++) {
          const [key, value] = capEntries[i];
          const cap = value.capabilities;
          const instanceId = String(key);
          const instanceOptions = mergeOptions(this.options, cap['wdio:tauriServiceOptions']);
          this.instanceOptions.set(instanceId, instanceOptions);

          // Each instance gets a unique port (base + i)
          const embeddedPort = basePort + i;
          const appBinaryPath = cap['tauri:options']?.application;

          if (!appBinaryPath) {
            throw new Error(`Tauri application path not specified for multiremote instance: ${key}`);
          }

          log.debug(`Starting embedded WebDriver for ${key} on port ${embeddedPort}`);

          // Store embedded mode info and app binary path globally for triggerDeeplink
          setEmbeddedModeInfo(true, appBinaryPath);

          // Spawn the app with embedded WebDriver
          try {
            const driverInfo = await startEmbeddedDriver(appBinaryPath, embeddedPort, instanceOptions, instanceId);
            this.embeddedProcesses.set(instanceId, driverInfo);
            this.embeddedConfigs.set(instanceId, { appBinaryPath, port: embeddedPort, options: instanceOptions });
          } catch (error) {
            throw new SevereServiceError(`Failed to start embedded WebDriver for ${key}: ${(error as Error).message}`);
          }

          // Update capabilities to connect to the embedded WebDriver server
          (value as { port?: number; hostname?: string }).port = embeddedPort;
          (value as { port?: number; hostname?: string }).hostname = hostname;
          log.debug(`Set embedded WebDriver connection for ${key}: ${hostname}:${embeddedPort}`);
        }
      } else if (isCrabNebula) {
        // CrabNebula provider: spawn tauri-driver per multiremote instance
        // On macOS: also spawn test-runner-backend per instance (tauri-driver proxies via REMOTE_WEBDRIVER_URL)
        // On other platforms: tauri-driver works directly without the backend (same as official provider)
        setCrabnebulaModeInfo(true);

        const hostname = '127.0.0.1';
        const isMacOS = process.platform === 'darwin';

        // On macOS, spawn test-runner-backends
        const backendPorts: number[] = [];
        if (isMacOS) {
          log.info(`Starting ${capEntries.length} CrabNebula test-runner-backend(s) for multiremote`);
          const basePort = mergedOptions.crabnebulaBackendPort ?? 3000;
          for (let i = 0; i < capEntries.length; i++) {
            const port = basePort + i * 2;
            await this.backendPortManager.allocatePortPair(port, port + 1);
            backendPorts.push(port);
          }
        }

        // Allocate tauri-driver ports for each instance
        const driverPortPairs = await this.portManager.allocatePorts(capEntries.length);

        log.info(`Starting ${capEntries.length} CrabNebula tauri-driver instance(s) for multiremote`);

        for (let i = 0; i < capEntries.length; i++) {
          const [key, value] = capEntries[i];
          const cap = value.capabilities;
          const instanceId = String(key);
          const instanceOptions = mergeOptions(this.options, cap['wdio:tauriServiceOptions']);
          this.instanceOptions.set(instanceId, instanceOptions);

          const dataDir = generateDataDirectory(instanceId);
          const envVarName = process.platform === 'linux' ? 'XDG_DATA_HOME' : 'TAURI_DATA_DIR';
          const env: NodeJS.ProcessEnv = { ...process.env, [envVarName]: dataDir };

          // On macOS, start backend and set REMOTE_WEBDRIVER_URL for tauri-driver
          if (isMacOS) {
            const backendPort = backendPorts[i];
            log.debug(`Starting CrabNebula test-runner-backend for ${key} on port ${backendPort}`);

            const { proc } = await startTestRunnerBackend({
              port: backendPort,
              serviceOptions: instanceOptions,
              instanceId,
            });
            await waitTestRunnerBackendReady(hostname, backendPort, 30000);

            this.workerBackends.set(instanceId, { proc, port: backendPort });
            env.REMOTE_WEBDRIVER_URL = `http://${hostname}:${backendPort}`;
          }

          const { port: driverPort, nativePort: driverNativePort } = driverPortPairs[i];

          log.debug(
            `Starting tauri-driver for ${key} on ${hostname}:${driverPort} ` +
              `(native port: ${driverNativePort}${isMacOS ? `, backend: ${hostname}:${backendPorts[i]}` : ''})`,
          );

          await this.startTauriDriverForInstance(instanceId, driverPort, driverNativePort, env, instanceOptions);

          (value as { port?: number; hostname?: string }).port = driverPort;
          (value as { port?: number; hostname?: string }).hostname = hostname;

          log.debug(`Set CrabNebula connection for ${key}: ${hostname}:${driverPort}`);
        }

        // Store configs for cycling between workers (backend state degrades across sessions)
        if (isMacOS) {
          this.cnCycleConfigs = capEntries.map(([key, value], i) => {
            const cap = value.capabilities;
            const instanceId = String(key);
            const instanceOptions = mergeOptions(this.options, cap['wdio:tauriServiceOptions']);
            const dataDir = generateDataDirectory(instanceId);
            const envVarName = process.platform === 'linux' ? 'XDG_DATA_HOME' : 'TAURI_DATA_DIR';
            const env: NodeJS.ProcessEnv = {
              ...process.env,
              [envVarName]: dataDir,
              REMOTE_WEBDRIVER_URL: `http://${hostname}:${backendPorts[i]}`,
            };
            return {
              instanceId,
              backendPort: backendPorts[i],
              driverPort: driverPortPairs[i].port,
              driverNativePort: driverPortPairs[i].nativePort,
              env,
              options: instanceOptions,
            };
          });
        }
      } else {
        log.info(`Starting ${capEntries.length} tauri-driver instance(s) for multiremote`);

        // Allocate ports using PortManager
        const portPairs = await this.portManager.allocatePorts(capEntries.length);

        for (let i = 0; i < capEntries.length; i++) {
          const { port, nativePort } = portPairs[i];
          log.debug(`Allocated ports for instance ${i}: main=${port}, native=${nativePort}`);
        }

        // Prepare all instance configs first
        const instanceConfigs = capEntries.map(([key, value], i) => {
          const cap = value.capabilities;
          const instanceId = String(key);
          const instanceOptions = mergeOptions(this.options, cap['wdio:tauriServiceOptions']);
          this.instanceOptions.set(instanceId, instanceOptions);

          const dataDir = generateDataDirectory(instanceId);
          const envVarName = process.platform === 'linux' ? 'XDG_DATA_HOME' : 'TAURI_DATA_DIR';
          const env = { ...process.env, [envVarName]: dataDir };

          const { port: instancePort, nativePort: instanceNativePort } = portPairs[i];
          const instanceHost = '127.0.0.1';

          (value as { port?: number; hostname?: string }).port = instancePort;
          (value as { port?: number; hostname?: string }).hostname = instanceHost;

          log.debug(
            `Starting tauri-driver for ${key} (ID: ${instanceId}) on ${instanceHost}:${instancePort} ` +
              `(native port: ${instanceNativePort})`,
          );

          return {
            instanceId,
            instancePort,
            instanceNativePort,
            env,
            instanceOptions,
          };
        });

        // Start all drivers in parallel for faster multiremote startup
        const startPromises = instanceConfigs.map((config) =>
          this.startTauriDriverForInstance(
            config.instanceId,
            config.instancePort,
            config.instanceNativePort,
            config.env,
            config.instanceOptions,
          ),
        );

        await Promise.all(startPromises);
      }
    } else if (isEmbedded) {
      // Embedded provider: spawn app directly with embedded WebDriver server
      this.isEmbeddedMode = true;
      // Store embedded mode info globally for triggerDeeplink
      setEmbeddedModeInfo(true, undefined);
      log.info('Embedded provider mode - spawning Tauri app with embedded WebDriver server');

      const hostname = '127.0.0.1';

      // For each capability, spawn the app with embedded WebDriver
      for (let i = 0; i < capsList.length; i++) {
        const cap = capsList[i];
        const instanceOptions = mergeOptions(this.options, cap['wdio:tauriServiceOptions']);
        const embeddedPort = getEmbeddedPort(instanceOptions);
        const appBinaryPath = cap['tauri:options']?.application;

        if (!appBinaryPath) {
          throw new Error('Tauri application path not specified in tauri:options.application');
        }

        log.debug(`Starting embedded WebDriver for instance ${i} on port ${embeddedPort}`);

        // Store embedded mode info and app binary path globally for triggerDeeplink
        setEmbeddedModeInfo(true, appBinaryPath);

        // Spawn the app with embedded WebDriver
        try {
          const driverInfo = await startEmbeddedDriver(appBinaryPath, embeddedPort, instanceOptions, String(i));
          this.embeddedProcesses.set(String(i), driverInfo);
          this.embeddedConfigs.set(String(i), { appBinaryPath, port: embeddedPort, options: instanceOptions });
        } catch (error) {
          throw new SevereServiceError(
            `Failed to start embedded WebDriver for instance ${i}: ${(error as Error).message}`,
          );
        }

        // Update capabilities to connect to the embedded WebDriver server
        (cap as { port?: number; hostname?: string }).port = embeddedPort;
        (cap as { port?: number; hostname?: string }).hostname = hostname;
        log.debug(`Set embedded WebDriver connection on capabilities: ${hostname}:${embeddedPort}`);
      }

      // Small delay to ensure WebDriver server is fully ready
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } else {
      // Standard session: single shared tauri-driver or per-worker drivers
      if (this.perWorkerMode) {
        // Per-worker mode: drivers will be spawned in onWorkerStart()
        log.debug('Per-worker mode enabled - drivers will be spawned per worker in onWorkerStart()');
      } else {
        // Single driver mode: spawn one shared driver
        log.debug('Single driver mode - spawning shared tauri-driver');
        const hostname = '127.0.0.1';

        // Allocate ports using PortManager
        const { port, nativePort } = await this.portManager.allocatePortPair();

        try {
          await this.startTauriDriver(port, nativePort, capsList);
          log.info(`tauri-driver listening on ${hostname}:${port}`);
        } catch (error) {
          log.error(`Failed to start tauri-driver: ${error}`);
          throw new SevereServiceError(`Failed to start tauri-driver: ${(error as Error).message}`);
        }

        // Update the capabilities object with hostname and port so WDIO connects to tauri-driver
        for (const cap of capsList) {
          (cap as { port?: number; hostname?: string }).port = port;
          (cap as { port?: number; hostname?: string }).hostname = hostname;
          log.debug(`Set tauri-driver connection on capabilities: ${hostname}:${port}`);
        }

        // Store config for cycling between workers if CrabNebula on macOS
        if (process.platform === 'darwin' && isCrabNebula) {
          const backendPort = mergedOptions.crabnebulaBackendPort ?? 3000;
          this.cnCycleConfigs = [
            {
              instanceId: 'tauri-driver',
              backendPort,
              driverPort: port,
              driverNativePort: nativePort,
              env: { ...process.env },
              options: mergedOptions,
            },
          ];
        }
      }
    }

    log.debug('Tauri service prepared successfully');
  }

  // (data directory isolation is handled per spawned driver; no pre-setup needed)

  /**
   * Start worker session
   */
  async onWorkerStart(
    cid: string,
    caps: TauriCapabilities | TauriCapabilities[] | Record<string, { capabilities?: TauriCapabilities }> | undefined,
  ): Promise<void> {
    log.debug(`Starting Tauri worker session: ${cid}`);

    if (this.browserMode) {
      log.debug(`Worker ${cid}: browser mode — skipping driver setup`);
      return;
    }

    if (!caps) {
      log.warn('onWorkerStart: No capabilities provided, skipping setup');
      return;
    }

    const capsList: TauriCapabilities[] = [];
    let firstCap: TauriCapabilities | undefined;
    let instanceId: string | undefined;

    if (Array.isArray(caps)) {
      for (const cap of caps) {
        if (cap && typeof cap === 'object') {
          capsList.push(cap);
        }
      }

      firstCap = caps[0];
    } else {
      const maybeMultiRemote = caps as Record<string, { capabilities?: TauriCapabilities }>;
      const entries = Object.entries(maybeMultiRemote);
      const isMultiRemote = entries.every((entry) => entry && typeof entry === 'object' && 'capabilities' in entry);

      if (isMultiRemote) {
        for (const [, value] of entries) {
          const cap = value?.capabilities;
          if (cap && typeof cap === 'object') {
            capsList.push(cap);
          }
        }

        const [firstKey, firstValue] = entries[0] ?? [];
        if (firstValue?.capabilities) {
          firstCap = firstValue.capabilities;
          // Use the multiremote key as the instance ID
          instanceId = String(firstKey);
          log.debug(`Multiremote instance detected: ${String(firstKey)} (ID: ${instanceId})`);
        }
      } else if (caps && typeof caps === 'object') {
        const singleCap = caps as TauriCapabilities;
        capsList.push(singleCap);
        firstCap = singleCap;
      }
    }

    if (capsList.length === 0) {
      log.warn('onWorkerStart: No capability objects found to modify');
      return;
    }

    for (const cap of capsList) {
      // Ensure browserName is removed before sending to tauri-driver
      delete (cap as { browserName?: string }).browserName;
    }

    // Log DISPLAY status
    if (process.platform === 'linux') {
      log.debug(`Worker ${cid} DISPLAY: ${process.env.DISPLAY || 'not set'}`);
    }

    if (!firstCap) {
      log.warn('onWorkerStart: Unable to determine primary capabilities, skipping further setup');
      return;
    }

    // App binary path is already resolved in onPrepare
    // The application path now points directly to the binary (not the app directory)
    const appBinaryPath = firstCap?.['tauri:options']?.application;
    if (!appBinaryPath) {
      log.warn('Tauri application path not found in capabilities, skipping diagnostics');
      log.debug(`Capabilities structure: ${JSON.stringify(firstCap, null, 2)}`);
      return;
    }

    this.appBinaryPath = appBinaryPath;
    log.debug(`Using app binary path: ${this.appBinaryPath}`);

    // Verify the binary exists (it should, since we resolved it in onPrepare)
    if (!existsSync(this.appBinaryPath)) {
      log.error(`Tauri binary not found: ${this.appBinaryPath}`);
      return;
    }

    // For multiremote instances, ensure data directory isolation is set up
    // The single tauri-driver process will handle multiple sessions
    if (instanceId) {
      log.debug(`Multiremote instance ${instanceId} - data directory isolation already configured`);
    }

    // Per-worker mode: spawn dedicated driver for this worker
    // Skip for embedded provider - driver is already spawned in onPrepare
    if (this.perWorkerMode && !instanceId && !this.isEmbeddedMode) {
      log.debug(`Per-worker mode: spawning tauri-driver for worker ${cid}`);

      // Allocate ports for this worker
      const { port, nativePort } = await this.allocateWorkerPorts(cid);

      // Generate isolated data directory
      const dataDir = generateDataDirectory(`worker-${cid}`);

      // Merge options (global + capability-specific)
      const workerOptions = mergeOptions(this.options, firstCap['wdio:tauriServiceOptions']);

      // Set up environment variables for data directory isolation
      const envVarName = process.platform === 'linux' ? 'XDG_DATA_HOME' : 'TAURI_DATA_DIR';
      const workerEnv: NodeJS.ProcessEnv = { ...process.env, [envVarName]: dataDir };

      // CrabNebula on macOS: spawn dedicated test-runner-backend per worker
      if (process.platform === 'darwin' && workerOptions.driverProvider === 'crabnebula') {
        const manageBackend = workerOptions.crabnebulaManageBackend ?? true;
        if (manageBackend) {
          // Allocate unique port for this worker's backend using PortManager
          const backendPort = await this.backendPortManager.allocatePort();
          log.debug(`Spawning test-runner-backend for worker ${cid} on port ${backendPort}`);

          try {
            const { proc } = await startTestRunnerBackend({
              port: backendPort,
              serviceOptions: workerOptions,
              instanceId: cid,
            });
            await waitTestRunnerBackendReady('127.0.0.1', backendPort, 30000);
            this.workerBackends.set(cid, { proc, port: backendPort });
            workerEnv.REMOTE_WEBDRIVER_URL = `http://127.0.0.1:${backendPort}`;
            log.debug(`Worker ${cid} backend ready on port ${backendPort}`);
          } catch (error) {
            log.error(`Failed to start test-runner-backend for worker ${cid}: ${error}`);
            throw error;
          }
        }
      }

      // Spawn tauri-driver for this worker with updated env
      await this.startTauriDriverForWorker(cid, port, nativePort, workerOptions, workerEnv);

      // Update capabilities with allocated port so WDIO connects to correct port
      // This is critical - the worker needs to know which port to connect to
      const hostname = '127.0.0.1';
      for (const cap of capsList) {
        (cap as { port?: number; hostname?: string }).port = port;
        (cap as { port?: number; hostname?: string }).hostname = hostname;
        log.debug(`Updated worker ${cid} capabilities: ${hostname}:${port}`);
      }
    }

    // For embedded mode (non-per-worker), check if the app is still alive and restart if needed.
    // On Windows the embedded Tauri process can crash after a WebDriver session is deleted,
    // causing ECONNREFUSED for all subsequent spec files.
    if (this.isEmbeddedMode && !this.perWorkerMode) {
      await this.ensureEmbeddedServersHealthy();
    }

    await this.diagnoseEnvironment(
      this.appBinaryPath,
      mergeOptions(this.options, firstCap['wdio:tauriServiceOptions']),
    );

    log.debug(`Tauri worker session started: ${cid}`);
  }

  /**
   * Health-check all embedded WebDriver servers and restart any that have crashed.
   * Required on Windows where the Tauri process can die after session deletion,
   * making all subsequent spec files fail with ECONNREFUSED.
   *
   * On Windows, additional stability probes run after a passing check to close the
   * race window between the health check and WDIO's POST /session.
   */
  private async ensureEmbeddedServersHealthy(): Promise<void> {
    for (const [instanceId, config] of this.embeddedConfigs) {
      const isAlive = await checkEmbeddedServerAlive(config.port, config.options.statusPollTimeout);
      if (!isAlive) {
        await this.restartEmbeddedServer(instanceId, config);
      } else {
        log.debug(`Embedded WebDriver on port ${config.port} (instance: ${instanceId}) is healthy`);
        if (process.platform === 'win32') {
          await this.verifyEmbeddedServerStable(instanceId, config);
        }
      }
    }
  }

  private async restartEmbeddedServer(
    instanceId: string,
    config: { appBinaryPath: string; port: number; options: TauriServiceOptions },
  ): Promise<void> {
    log.warn(`Embedded WebDriver on port ${config.port} (instance: ${instanceId}) is unreachable — restarting...`);
    const existing = this.embeddedProcesses.get(instanceId);
    if (existing) {
      try {
        await stopEmbeddedDriver(existing);
      } catch {
        // Process may already be dead; ignore
      }
    }
    try {
      const newInfo = await startEmbeddedDriver(config.appBinaryPath, config.port, config.options, instanceId);
      this.embeddedProcesses.set(instanceId, newInfo);
      log.info(`✅ Embedded WebDriver restarted on port ${config.port} (instance: ${instanceId})`);
    } catch (error) {
      throw new SevereServiceError(
        `Failed to restart embedded WebDriver on port ${config.port}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * After a passing health check on Windows, re-probe several times at short intervals
   * to catch a server that is about to crash. Closes the race window between the
   * initial probe and WDIO's first POST /session request.
   */
  private async verifyEmbeddedServerStable(
    instanceId: string,
    config: { appBinaryPath: string; port: number; options: TauriServiceOptions },
  ): Promise<void> {
    const PROBE_COUNT = 3;
    const PROBE_INTERVAL_MS = 500;
    for (let i = 0; i < PROBE_COUNT; i++) {
      await new Promise<void>((resolve) => setTimeout(resolve, PROBE_INTERVAL_MS));
      const isAlive = await checkEmbeddedServerAlive(config.port, config.options.statusPollTimeout);
      if (!isAlive) {
        log.warn(
          `Embedded WebDriver on port ${config.port} died during stability check (probe ${i + 1}/${PROBE_COUNT}), restarting...`,
        );
        await this.restartEmbeddedServer(instanceId, config);
        return;
      }
    }
    log.debug(`Embedded WebDriver on port ${config.port} passed ${PROBE_COUNT} stability probes`);
  }

  /**
   * Diagnose the environment before running tests
   */
  private async diagnoseEnvironment(binaryPath: string, options: TauriServiceOptions): Promise<void> {
    const results = await diagnoseTauriEnvironment(binaryPath, options);
    formatDiagnosticResults(results);
  }

  /**
   * Allocate ports for a worker
   */
  private async allocateWorkerPorts(workerId: string): Promise<{ port: number; nativePort: number }> {
    const status = this.driverPool.getStatus();
    const preferredPort = (this.options.tauriDriverPort || 4444) + status.count;
    const preferredNativePort = 4445 + status.count;
    const { port, nativePort } = await this.portManager.allocatePortPair(preferredPort, preferredNativePort);

    log.debug(`Allocated ports for worker ${workerId}: main=${port}, native=${nativePort}`);
    return { port, nativePort };
  }

  /**
   * Start tauri-driver for a specific worker
   */
  private async startTauriDriverForWorker(
    workerId: string,
    port: number,
    nativePort: number,
    options?: TauriServiceOptions,
    env?: NodeJS.ProcessEnv,
  ): Promise<void> {
    const workerOptions = options ?? mergeOptions(this.options, undefined);
    const envVarName = process.platform === 'linux' ? 'XDG_DATA_HOME' : 'TAURI_DATA_DIR';

    await this.driverPool.startDriver({
      mode: 'worker',
      identifier: workerId,
      port,
      nativePort,
      options: workerOptions,
      env: env ?? { ...process.env, [envVarName]: process.env[envVarName] },
      instanceId: workerId,
    });
  }

  /**
   * End worker session
   */
  async onWorkerEnd(cid: string): Promise<void> {
    log.debug(`Ending Tauri worker session: ${cid}`);

    if (this.browserMode) {
      return;
    }

    // Stop worker's test-runner-backend if spawned (CrabNebula per-worker mode)
    const workerBackend = this.workerBackends.get(cid);
    if (workerBackend) {
      log.debug(`Stopping test-runner-backend for worker ${cid}`);
      await stopTestRunnerBackend(workerBackend.proc);
      this.workerBackends.delete(cid);
    }

    if (this.perWorkerMode) {
      await this.driverPool.stopDriver(cid);
    }

    // CrabNebula (macOS): cycle backends + drivers between workers
    // The test-runner-backend's internal websocket state degrades across session destroy/create
    // cycles, causing stale native port references and "Connection refused" errors.
    if (this.cnCycleConfigs) {
      await this.cycleCnInfrastructure();
    }
  }

  /**
   * Restart backends and tauri-drivers for CrabNebula instances between workers.
   * Required because the test-runner-backend's internal websocket state degrades
   * across session destroy/create cycles, leaving stale native port references.
   */
  private async cycleCnInfrastructure(): Promise<void> {
    const configs = this.cnCycleConfigs;
    if (!configs) return;

    const hostname = '127.0.0.1';
    log.info(`Cycling ${configs.length} CrabNebula backend(s) + driver(s) between workers`);

    // Stop existing backends and drivers
    for (const config of configs) {
      // Backend may be in workerBackends (multiremote) or testRunnerBackend (single-driver)
      const backend = this.workerBackends.get(config.instanceId);
      if (backend) {
        log.debug(`Stopping backend for ${config.instanceId}`);
        await stopTestRunnerBackend(backend.proc);
        this.workerBackends.delete(config.instanceId);
      } else if (this.testRunnerBackend) {
        log.debug(`Stopping shared backend for ${config.instanceId}`);
        await stopTestRunnerBackend(this.testRunnerBackend);
        this.testRunnerBackend = undefined;
      }
      await this.driverPool.stopDriver(config.instanceId);
    }

    // Restart backends and drivers with the same ports
    for (const config of configs) {
      log.debug(`Restarting backend for ${config.instanceId} on port ${config.backendPort}`);
      const { proc } = await startTestRunnerBackend({
        port: config.backendPort,
        serviceOptions: config.options,
        instanceId: config.instanceId,
      });
      await waitTestRunnerBackendReady(hostname, config.backendPort, 30000);

      // Store in the same location it was originally stored
      if (configs.length === 1 && config.instanceId === 'tauri-driver') {
        this.testRunnerBackend = proc;
        process.env.REMOTE_WEBDRIVER_URL = `http://${hostname}:${config.backendPort}`;
      } else {
        this.workerBackends.set(config.instanceId, { proc, port: config.backendPort });
      }

      log.debug(`Restarting tauri-driver for ${config.instanceId} on port ${config.driverPort}`);
      await this.startTauriDriverForInstance(
        config.instanceId,
        config.driverPort,
        config.driverNativePort,
        config.env,
        config.options,
      );
    }

    log.info('CrabNebula infrastructure cycled successfully');
  }

  /**
   * Complete service lifecycle
   */
  async onComplete(_exitCode: number, _config: Options.Testrunner, _capabilities: TauriCapabilities[]): Promise<void> {
    log.debug('Completing Tauri service...');

    await this.#stopDevServer?.();
    this.#stopDevServer = undefined;

    try {
      const { closeLogWriter } = await import('./logWriter.js');
      await closeLogWriter();
    } catch {
      // Log writer may not have been initialized
    }

    // Stop all worker test-runner-backends (per-worker mode)
    if (this.workerBackends.size > 0) {
      log.info(`Stopping ${this.workerBackends.size} worker test-runner-backend(s)...`);
      for (const [workerId, backend] of this.workerBackends) {
        try {
          await stopTestRunnerBackend(backend.proc);
          log.debug(`Stopped test-runner-backend for worker ${workerId}`);
        } catch (error) {
          log.warn(`Failed to stop test-runner-backend for worker ${workerId}: ${error}`);
        }
      }
      this.workerBackends.clear();
    }

    // Stop shared test-runner-backend (if any)
    if (this.testRunnerBackend) {
      await stopTestRunnerBackend(this.testRunnerBackend);
      this.testRunnerBackend = undefined;
    }

    // Stop embedded driver processes if using embedded provider
    if (this.isEmbeddedMode) {
      log.info(`Stopping ${this.embeddedProcesses.size} embedded driver process(es)...`);
      for (const [key, process] of this.embeddedProcesses) {
        try {
          await stopEmbeddedDriver(process);
          log.debug(`Stopped embedded driver: ${key}`);
        } catch (error) {
          log.warn(`Failed to stop embedded driver ${key}: ${error}`);
        }
      }
      this.embeddedProcesses.clear();
    }

    await this.driverPool.stopAll();
    this.instanceOptions.clear();
    this.embeddedConfigs.clear();
    this.portManager.clear();
    this.backendPortManager.clear();

    log.debug('Tauri service completed');
  }

  /**
   * Start tauri-driver process
   */
  private async startTauriDriver(port: number, nativePort: number, capabilities?: TauriCapabilities[]): Promise<void> {
    const firstCap = capabilities?.[0];
    const options = mergeOptions(this.options, firstCap?.['wdio:tauriServiceOptions']);
    log.debug(`Single driver mode options: ${JSON.stringify(options, null, 2)}`);
    log.debug(
      `Single driver mode: captureFrontendLogs=${options.captureFrontendLogs}, captureBackendLogs=${options.captureBackendLogs}`,
    );

    if (process.platform === 'linux') {
      log.info(`Starting tauri-driver (DISPLAY from environment: ${process.env.DISPLAY || 'not set'})`);
    }

    await this.driverPool.startDriver({
      mode: 'single',
      identifier: 'tauri-driver',
      port,
      nativePort,
      options,
      env: options.env,
    });
  }

  /**
   * Start tauri-driver process for a specific multiremote instance
   */
  private async startTauriDriverForInstance(
    instanceId: string,
    port: number,
    nativePort: number,
    env: NodeJS.ProcessEnv,
    options?: TauriServiceOptions,
  ): Promise<void> {
    const instanceOptions = options ?? mergeOptions(this.options, undefined);

    await this.driverPool.startDriver({
      mode: 'multiremote',
      identifier: instanceId,
      port,
      nativePort,
      options: instanceOptions,
      env,
      instanceId,
    });
  }

  /**
   * Validate CrabNebula prerequisites for macOS testing
   * Checks for CN_API_KEY and test-runner-backend availability
   */
  private async validateCrabNebulaPrerequisites(options: TauriServiceOptions): Promise<void> {
    log.info('Validating CrabNebula prerequisites for macOS...');

    if (!process.env.CN_API_KEY) {
      throw new Error(
        'CN_API_KEY environment variable is required for CrabNebula macOS testing. ' +
          'Contact CrabNebula (https://crabnebula.dev) to obtain an API key. ' +
          'See: https://docs.crabnebula.dev/tauri/webdriver/',
      );
    }

    const manageBackend = options.crabnebulaManageBackend ?? true;
    if (manageBackend) {
      const backendPath = findTestRunnerBackend();
      if (!backendPath) {
        throw new Error(
          '@crabnebula/test-runner-backend not found. ' +
            'Install with: npm install -D @crabnebula/test-runner-backend',
        );
      }
      log.debug(`Found test-runner-backend at: ${backendPath}`);
    }

    log.info('✅ CrabNebula prerequisites validated');
  }

  /**
   * Get tauri-driver status
   */
  getTauriDriverStatus(): { running: boolean; pid?: number } {
    const status = this.driverPool.getStatus();
    const pids = this.driverPool.getRunningPids();
    return {
      running: status.running,
      pid: pids[0],
    };
  }
}
