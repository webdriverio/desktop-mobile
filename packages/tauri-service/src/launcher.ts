import type { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  closeLogWriter,
  getLogWriter,
  isLogWriterInitialized,
  nonChromeBrowserNameError,
  normaliseInstanceCaps,
  PortManager,
  probeDevServerReachable,
  startManagedDevServer,
} from '@wdio/native-core';
import {
  createLogger,
  describeDisplay,
  errorMessage,
  formatDiagnosticResults,
  isErr,
  severeServiceError,
} from '@wdio/native-utils';
import type { Options } from '@wdio/types';
import { SevereServiceError } from 'webdriverio';
import { resolveAppArgs, resolveAppBinaryPath } from './appBinaryResolver.js';
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
import { appEnv, hideEnvValues, mergeServiceOptions } from './serviceConfig.js';
import type { DriverProvider, TauriCapabilities, TauriServiceGlobalOptions, TauriServiceOptions } from './types.js';

const log = createLogger('tauri-service', 'launcher');

/**
 * Generate unique data directory for multiremote instance or worker
 */
function generateDataDirectory(instanceId: string): string {
  const baseTempDir = tmpdir();
  // Support both multiremote instances and worker IDs
  const prefix = instanceId.startsWith('worker-') ? 'tauri' : 'tauri-multiremote';
  // The pid keeps concurrent runs on one host from sharing, or removing, each other's directory.
  const dataDir = join(baseTempDir, `${prefix}-${instanceId}-${process.pid}`);

  log.debug(`Generated data directory for ${instanceId}: ${dataDir}`);
  return dataDir;
}

function dataDirEnv(dataDir: string): NodeJS.ProcessEnv {
  return { [process.platform === 'linux' ? 'XDG_DATA_HOME' : 'TAURI_DATA_DIR']: dataDir };
}

// tauri-driver proxies to a CrabNebula backend through REMOTE_WEBDRIVER_URL. Set as a service var, it wins over
// a REMOTE_WEBDRIVER_URL in the app's env, so the driver reaches the backend the service started.
function backendDriverEnv(backendEnv: NodeJS.ProcessEnv | undefined, backendPort: number): NodeJS.ProcessEnv {
  return { ...backendEnv, REMOTE_WEBDRIVER_URL: `http://127.0.0.1:${backendPort}` };
}

// A CrabNebula backend and tauri-driver to restart between workers, with the env the backend was started with
interface CnCycleConfig {
  instanceId: string;
  backendPort: number;
  driverPort: number;
  driverNativePort: number;
  backendEnv?: NodeJS.ProcessEnv;
  options: TauriServiceOptions;
}

interface EmbeddedLaunchConfig {
  appBinaryPath: string;
  appArgs: string[];
  port: number;
  options: TauriServiceOptions;
}

const DRIVER_PROVIDERS: readonly DriverProvider[] = ['embedded', 'external', 'crabnebula'];

function assertDriverProvider(value: unknown): void {
  if (value === undefined || DRIVER_PROVIDERS.includes(value as DriverProvider)) {
    return;
  }
  throw new SevereServiceError(
    `driverProvider must be 'embedded', 'external' or 'crabnebula', not ${JSON.stringify(value)}.`,
  );
}

function mergeOptions(
  globalOptions: TauriServiceGlobalOptions,
  capabilityOptions?: TauriServiceOptions,
): TauriServiceOptions {
  assertDriverProvider(capabilityOptions?.driverProvider ?? globalOptions.driverProvider);
  return mergeServiceOptions(globalOptions, capabilityOptions);
}

function assertSingleDriverProvider(globalOptions: TauriServiceGlobalOptions, capsList: TauriCapabilities[]): void {
  const providers = new Set(
    capsList.map((cap) => mergeOptions(globalOptions, cap['wdio:tauriServiceOptions']).driverProvider ?? 'embedded'),
  );
  if (providers.size > 1) {
    throw new SevereServiceError(
      `All Tauri capabilities must use the same driverProvider, but found mixed providers: ${[...providers].join(', ')}. ` +
        "Set driverProvider in the service options, or to the same value in every 'wdio:tauriServiceOptions' entry. " +
        "An unset driverProvider is 'embedded'.",
    );
  }
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
  // Teardown for a service-managed dev server (browser mode). Called on an onPrepare failure and again from
  // onComplete, which WDIO and standalone sessions still run after one, so it's idempotent.
  #stopDevServer?: () => Promise<void>;
  private embeddedProcesses: Map<string, EmbeddedDriverInfo> = new Map();
  private embeddedConfigs: Map<string, EmbeddedLaunchConfig> = new Map();
  private isEmbeddedMode: boolean = false;
  private workerBackends: Map<string, { proc: ChildProcess; port: number }> = new Map();
  private dataDirectories: Map<string, string> = new Map();
  private cnCycleConfigs?: CnCycleConfig[];

  constructor(
    private options: TauriServiceGlobalOptions,
    capabilities: TauriCapabilities,
    config: Options.Testrunner,
  ) {
    log.debug('TauriLaunchService initialized');
    log.debug('Capabilities:', JSON.stringify(capabilities, hideEnvValues, 2));
    // Not the whole config, which can hold credentials such as a cloud provider's key
    log.debug(`Config: maxInstances=${config.maxInstances}, outputDir=${config.outputDir}`);

    const basePort = options.tauriDriverPort || 4444;
    this.portManager = new PortManager(basePort, 4445);
    this.backendPortManager = new PortManager(options.crabnebulaBackendPort ?? 3000, 3001);
    this.driverPool = new DriverPool(options, options.nativeDriverPath);
  }

  get isBrowserMode(): boolean {
    return this.browserMode;
  }

  /**
   * Prepare the Tauri service
   */
  async onPrepare(
    config: Options.Testrunner,
    capabilities: TauriCapabilities[] | Record<string, { capabilities: TauriCapabilities }>,
  ): Promise<void> {
    // WebdriverIO stops the run only for a SevereServiceError: it logs any other launcher error and carries on
    try {
      await this.prepare(config, capabilities);
    } catch (error) {
      // WebdriverIO prints only the SevereServiceError's stack, so this keeps where the failure came from
      const cause = error instanceof SevereServiceError ? error.cause : error;
      if (cause !== undefined) {
        log.error('Tauri service failed to prepare', cause);
      }
      throw error instanceof SevereServiceError ? error : severeServiceError(error);
    }
  }

  private async prepare(
    _config: Options.Testrunner,
    capabilities: TauriCapabilities[] | Record<string, { capabilities: TauriCapabilities }>,
  ): Promise<void> {
    log.debug('Preparing Tauri service...');

    const instances = normaliseInstanceCaps(capabilities);
    const capsList = instances.map(({ caps }) => caps);
    assertSingleDriverProvider(this.options, capsList);

    // Determine provider type
    const firstCap = capsList[0];
    const mergedOptions = mergeOptions(this.options, firstCap?.['wdio:tauriServiceOptions']);
    const isCrabNebula = mergedOptions.driverProvider === 'crabnebula';
    const isEmbedded = isEmbeddedProvider(mergedOptions);

    if (isEmbedded && !mergedOptions.driverProvider) {
      log.info(
        `No driverProvider configured — defaulting to embedded WebDriver provider (port ${getEmbeddedPort(mergedOptions)}). ` +
          `Set driverProvider: 'external' to use tauri-driver instead.`,
      );
    }

    if (process.platform === 'darwin' && isCrabNebula) {
      await this.validateCrabNebulaPrerequisites(mergedOptions);
    }

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
      // is up stops it straight away, rather than leaving it running until onComplete.
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
        this.browserMode = true;
        for (const cap of capsList) {
          (cap as { browserName?: string }).browserName = 'chrome';
          delete (cap as { 'tauri:options'?: unknown })['tauri:options'];
          // The worker reads mode and devServerUrl from here; a devServer function may have changed the URL.
          const capRecord = cap as Record<string, unknown>;
          capRecord['wdio:tauriServiceOptions'] = {
            ...(capRecord['wdio:tauriServiceOptions'] as Record<string, unknown> | undefined),
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

    const apps = this.resolveApps(capsList);
    const firstApp = apps[0];

    // Ensure Edge WebDriver compatibility on Windows — once, after all caps are
    // resolved. msedgedriver is a single machine-global driver, so one check
    // (matched to the first resolved binary) covers every instance. Keep this
    // outside the resolution loop: a break here would skip the remaining caps.
    if (!isEmbedded && process.platform === 'win32' && firstApp !== undefined) {
      const autoDownloadEdgeDriver = this.options.autoDownloadEdgeDriver ?? true;
      log.debug('Checking Edge WebDriver compatibility...');
      // msedgedriver is machine-global, so the version pin is service-level only. The fixed-runtime
      // folder comes from the first capability, like the binary: its webviewOptions, or the env its app gets.
      const edgeDriverResult = await ensureMsEdgeDriver(firstApp.appBinaryPath, autoDownloadEdgeDriver, {
        edgeDriverVersion: this.options.edgeDriverVersion,
        env: firstApp.options.env,
        browserExecutableFolder: capsList[0]['tauri:options']?.webviewOptions?.browserExecutableFolder,
      });

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
      } else {
        if (edgeDriverResult.value.method === 'downloaded') {
          log.info(
            `✅ Downloaded msedgedriver ${edgeDriverResult.value.driverVersion} for WebView2 ${edgeDriverResult.value.edgeVersion}`,
          );
        } else if (edgeDriverResult.value.method === 'found') {
          log.info(`✅ Using existing msedgedriver ${edgeDriverResult.value.driverVersion}`);
        }
        // Passed by path rather than through PATH, which a PATH in the app's env would hide from tauri-driver
        if (edgeDriverResult.value.driverPath) {
          this.driverPool.useNativeDriver(edgeDriverResult.value.driverPath);
        }
      }
    }

    // For embedded provider: skip tauri-driver installation
    // For external/crabnebula: ensure tauri-driver is installed
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
    }

    // Initialize file log writer if log capture is enabled
    // Uses WDIO's outputDir config option for log file location
    if (mergedOptions.captureBackendLogs || mergedOptions.captureFrontendLogs) {
      try {
        if (isLogWriterInitialized('tauri-service')) {
          log.debug('Log writer already initialized, skipping re-initialization');
        } else {
          const logDir = _config.outputDir || join(process.cwd(), 'logs');
          getLogWriter('tauri-service').initialize(logDir);
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
    const isMultiremote = instances.some(({ name }) => name !== undefined);
    this.perWorkerMode = maxInstances > 1 && !isMultiremote;

    log.debug(
      `Per-worker mode: ${this.perWorkerMode ? 'enabled' : 'disabled'} (maxInstances=${maxInstances}, multiremote=${isMultiremote})`,
    );

    // Start shared test-runner-backend for CrabNebula on macOS (single-driver mode only)
    // In per-worker mode, each worker spawns its own backend in onWorkerStart()
    // Skip for multiremote - we spawn one backend per instance in the multiremote block below
    let sharedBackendPort: number | undefined;
    if (process.platform === 'darwin' && isCrabNebula && !this.perWorkerMode && !isMultiremote) {
      const manageBackend = mergedOptions.crabnebulaManageBackend ?? true;
      if (manageBackend) {
        const backendPort = mergedOptions.crabnebulaBackendPort ?? 3000;
        // Allocate port to prevent collision with worker backends
        await this.backendPortManager.allocatePortPair(backendPort, backendPort + 1);
        const { proc } = await startTestRunnerBackend({ port: backendPort, serviceOptions: mergedOptions });
        await waitTestRunnerBackendReady('127.0.0.1', backendPort, 30000);

        this.testRunnerBackend = proc;
        sharedBackendPort = backendPort;
        log.info(`CrabNebula backend ready on port ${backendPort}`);
      }
    }

    // Multiremote: spawn a dedicated driver per instance on unique ports
    if (isMultiremote) {
      if (isEmbedded) {
        // Embedded provider: spawn each app with unique embedded ports
        this.isEmbeddedMode = true;
        log.info(`Starting ${instances.length} embedded WebDriver instance(s) for multiremote`);

        const hostname = '127.0.0.1';

        for (let i = 0; i < instances.length; i++) {
          const { name, caps: cap, connectionTarget } = instances[i];
          const instanceId = name ?? String(i);
          const instanceOptions = apps[i].options;
          this.instanceOptions.set(instanceId, instanceOptions);

          const embeddedPort = await this.allocateEmbeddedPort(cap, instanceOptions, i);
          const { appBinaryPath, appArgs } = apps[i];

          log.debug(`Starting embedded WebDriver for ${instanceId} on port ${embeddedPort}`);

          // Spawn the app with embedded WebDriver
          try {
            const driverInfo = await startEmbeddedDriver(
              appBinaryPath,
              appArgs,
              embeddedPort,
              instanceOptions,
              instanceId,
            );
            this.embeddedProcesses.set(instanceId, driverInfo);
            this.embeddedConfigs.set(instanceId, {
              appBinaryPath,
              appArgs,
              port: embeddedPort,
              options: instanceOptions,
            });
          } catch (error) {
            throw severeServiceError(`Failed to start embedded WebDriver for ${instanceId}`, error);
          }

          // Update capabilities to connect to the embedded WebDriver server
          connectionTarget.port = embeddedPort;
          connectionTarget.hostname = hostname;
          log.debug(`Set embedded WebDriver connection for ${instanceId}: ${hostname}:${embeddedPort}`);
        }
      } else if (isCrabNebula) {
        // CrabNebula provider: spawn tauri-driver per multiremote instance
        // On macOS: also spawn test-runner-backend per instance (tauri-driver proxies via REMOTE_WEBDRIVER_URL)
        // On other platforms: tauri-driver works directly without the backend (same as the external provider)

        const hostname = '127.0.0.1';
        const isMacOS = process.platform === 'darwin';

        // On macOS, spawn test-runner-backends
        const backendPorts: number[] = [];
        if (isMacOS) {
          log.info(`Starting ${instances.length} CrabNebula test-runner-backend(s) for multiremote`);
          const basePort = mergedOptions.crabnebulaBackendPort ?? 3000;
          for (let i = 0; i < instances.length; i++) {
            const port = basePort + i * 2;
            await this.backendPortManager.allocatePortPair(port, port + 1);
            backendPorts.push(port);
          }
        }

        // Allocate tauri-driver ports for each instance
        const driverPortPairs = await this.portManager.allocatePorts(instances.length);

        log.info(`Starting ${instances.length} CrabNebula tauri-driver instance(s) for multiremote`);

        const cycleConfigs: CnCycleConfig[] = [];
        for (let i = 0; i < instances.length; i++) {
          const { name, connectionTarget } = instances[i];
          const instanceId = name ?? String(i);
          const instanceOptions = apps[i].options;
          this.instanceOptions.set(instanceId, instanceOptions);

          const instanceEnv = dataDirEnv(this.allocateDataDirectory(instanceId));
          let env = instanceEnv;
          const { port: driverPort, nativePort: driverNativePort } = driverPortPairs[i];

          // On macOS, start backend and set REMOTE_WEBDRIVER_URL for tauri-driver
          if (isMacOS) {
            const backendPort = backendPorts[i];
            log.debug(`Starting CrabNebula test-runner-backend for ${instanceId} on port ${backendPort}`);

            const { proc } = await startTestRunnerBackend({
              port: backendPort,
              serviceOptions: instanceOptions,
              env: instanceEnv,
              instanceId,
            });
            await waitTestRunnerBackendReady(hostname, backendPort, 30000);

            this.workerBackends.set(instanceId, { proc, port: backendPort });
            env = backendDriverEnv(instanceEnv, backendPort);
            // Kept for cycling between workers (backend state degrades across sessions)
            cycleConfigs.push({
              instanceId,
              backendPort,
              driverPort,
              driverNativePort,
              backendEnv: instanceEnv,
              options: instanceOptions,
            });
          }

          log.debug(
            `Starting tauri-driver for ${instanceId} on ${hostname}:${driverPort} ` +
              `(native port: ${driverNativePort}${isMacOS ? `, backend: ${hostname}:${backendPorts[i]}` : ''})`,
          );

          await this.driverPool.startDriver({
            mode: 'multiremote',
            identifier: instanceId,
            port: driverPort,
            nativePort: driverNativePort,
            options: instanceOptions,
            env,
            instanceId,
          });

          connectionTarget.port = driverPort;
          connectionTarget.hostname = hostname;

          log.debug(`Set CrabNebula connection for ${instanceId}: ${hostname}:${driverPort}`);
        }

        if (isMacOS) {
          this.cnCycleConfigs = cycleConfigs;
        }
      } else {
        log.info(`Starting ${instances.length} tauri-driver instance(s) for multiremote`);

        // Allocate ports using PortManager
        const portPairs = await this.portManager.allocatePorts(instances.length);

        for (let i = 0; i < instances.length; i++) {
          const { port, nativePort } = portPairs[i];
          log.debug(`Allocated ports for instance ${i}: main=${port}, native=${nativePort}`);
        }

        // Prepare all instance configs first
        const instanceConfigs = instances.map(({ name, connectionTarget }, i) => {
          const instanceId = name ?? String(i);
          const instanceOptions = apps[i].options;
          this.instanceOptions.set(instanceId, instanceOptions);

          const env = dataDirEnv(this.allocateDataDirectory(instanceId));

          const { port: instancePort, nativePort: instanceNativePort } = portPairs[i];
          const instanceHost = '127.0.0.1';

          connectionTarget.port = instancePort;
          connectionTarget.hostname = instanceHost;

          log.debug(
            `Starting tauri-driver for ${instanceId} on ${instanceHost}:${instancePort} ` +
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
          this.driverPool.startDriver({
            mode: 'multiremote',
            identifier: config.instanceId,
            port: config.instancePort,
            nativePort: config.instanceNativePort,
            options: config.instanceOptions,
            env: config.env,
            instanceId: config.instanceId,
          }),
        );

        await Promise.all(startPromises);
      }
    } else if (isEmbedded) {
      // Embedded provider: spawn app directly with embedded WebDriver server
      this.isEmbeddedMode = true;
      log.info('Embedded provider mode - spawning Tauri app with embedded WebDriver server');

      const hostname = '127.0.0.1';

      // For each capability, spawn the app with embedded WebDriver
      for (let i = 0; i < instances.length; i++) {
        const { caps: cap, connectionTarget } = instances[i];
        const instanceOptions = apps[i].options;
        const embeddedPort = await this.allocateEmbeddedPort(cap, instanceOptions, i);
        const { appBinaryPath, appArgs } = apps[i];

        log.debug(`Starting embedded WebDriver for instance ${i} on port ${embeddedPort}`);

        // Spawn the app with embedded WebDriver
        try {
          const driverInfo = await startEmbeddedDriver(
            appBinaryPath,
            appArgs,
            embeddedPort,
            instanceOptions,
            String(i),
          );
          this.embeddedProcesses.set(String(i), driverInfo);
          this.embeddedConfigs.set(String(i), { appBinaryPath, appArgs, port: embeddedPort, options: instanceOptions });
        } catch (error) {
          throw severeServiceError(`Failed to start embedded WebDriver for instance ${i}`, error);
        }

        // Update capabilities to connect to the embedded WebDriver server
        connectionTarget.port = embeddedPort;
        connectionTarget.hostname = hostname;
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
          await this.startTauriDriver(
            port,
            nativePort,
            mergedOptions,
            sharedBackendPort === undefined ? undefined : backendDriverEnv(undefined, sharedBackendPort),
          );
          log.info(`tauri-driver listening on ${hostname}:${port}`);
        } catch (error) {
          log.error(`Failed to start tauri-driver: ${error}`);
          throw severeServiceError('Failed to start tauri-driver', error);
        }

        // Update the capabilities object with hostname and port so WDIO connects to tauri-driver
        for (const { connectionTarget } of instances) {
          connectionTarget.port = port;
          connectionTarget.hostname = hostname;
          log.debug(`Set tauri-driver connection on capabilities: ${hostname}:${port}`);
        }

        // Kept for cycling the backend the service started, and its driver, between workers
        if (sharedBackendPort !== undefined) {
          this.cnCycleConfigs = [
            {
              instanceId: 'tauri-driver',
              backendPort: sharedBackendPort,
              driverPort: port,
              driverNativePort: nativePort,
              options: mergedOptions,
            },
          ];
        }
      }
    }

    log.debug('Tauri service prepared successfully');
  }

  private resolveApps(capsList: TauriCapabilities[]) {
    // Resolved per capability, in the order of `instances`
    const apps: Array<{ appBinaryPath: string; appArgs: string[]; options: TauriServiceOptions }> = [];
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
      const tauriOptions = cap['tauri:options'];
      const appBinaryPath = resolveAppBinaryPath(instanceOptions, tauriOptions);
      log.debug(`App binary: ${appBinaryPath}`);

      // tauri-driver launches the app from tauri:options, so the resolved binary and args go there, in a
      // copy: capabilities can share one tauri:options object, and each needs its own values.
      const args = resolveAppArgs(instanceOptions, tauriOptions);
      cap['tauri:options'] = { ...tauriOptions, application: appBinaryPath, args };
      apps.push({ appBinaryPath, appArgs: args, options: instanceOptions });
      if (args.length > 0) {
        log.debug(`App args: ${JSON.stringify(args)}`);
      }
    }
    return apps;
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

    if (process.platform === 'linux') {
      log.debug(`Worker ${cid} display: ${describeDisplay() ?? 'not set'}`);
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
      log.debug(`Capabilities structure: ${JSON.stringify(firstCap, hideEnvValues, 2)}`);
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

      // Merge options (global + capability-specific)
      const workerOptions = mergeOptions(this.options, firstCap['wdio:tauriServiceOptions']);

      const workerEnv = dataDirEnv(this.allocateDataDirectory(`worker-${cid}`));
      let driverEnv = workerEnv;

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
              env: workerEnv,
              instanceId: cid,
            });
            await waitTestRunnerBackendReady('127.0.0.1', backendPort, 30000);
            this.workerBackends.set(cid, { proc, port: backendPort });
            driverEnv = backendDriverEnv(workerEnv, backendPort);
            log.debug(`Worker ${cid} backend ready on port ${backendPort}`);
          } catch (error) {
            log.error(`Failed to start test-runner-backend for worker ${cid}: ${error}`);
            throw error;
          }
        }
      }

      await this.driverPool.startDriver({
        mode: 'worker',
        identifier: cid,
        port,
        nativePort,
        options: workerOptions,
        env: driverEnv,
        instanceId: cid,
      });

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

    if (!this.isEmbeddedMode) {
      await this.diagnoseEnvironment(
        this.appBinaryPath,
        mergeOptions(this.options, firstCap['wdio:tauriServiceOptions']),
      );
    }

    log.debug(`Tauri worker session started: ${cid}`);
  }

  private allocateEmbeddedPort(cap: TauriCapabilities, options: TauriServiceOptions, index: number): Promise<number> {
    const instancePort = cap['wdio:tauriServiceOptions']?.embeddedPort;
    return this.portManager.allocatePort(instancePort ?? getEmbeddedPort(options) + index);
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

  private async restartEmbeddedServer(instanceId: string, config: EmbeddedLaunchConfig): Promise<void> {
    log.warn(`Embedded WebDriver on port ${config.port} (instance: ${instanceId}) is unreachable — restarting...`);
    const existing = this.embeddedProcesses.get(instanceId);
    if (existing) {
      await stopEmbeddedDriver(existing);
      this.embeddedProcesses.delete(instanceId);
    }
    try {
      const newInfo = await startEmbeddedDriver(
        config.appBinaryPath,
        config.appArgs,
        config.port,
        config.options,
        instanceId,
      );
      this.embeddedProcesses.set(instanceId, newInfo);
      log.info(`✅ Embedded WebDriver restarted on port ${config.port} (instance: ${instanceId})`);
    } catch (error) {
      throw severeServiceError(`Failed to restart embedded WebDriver on port ${config.port}`, error);
    }
  }

  /**
   * After a passing health check on Windows, re-probe several times at short intervals
   * to catch a server that is about to crash. Closes the race window between the
   * initial probe and WDIO's first POST /session request.
   */
  private async verifyEmbeddedServerStable(instanceId: string, config: EmbeddedLaunchConfig): Promise<void> {
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

  private allocateDataDirectory(instanceId: string): string {
    const dataDir = generateDataDirectory(instanceId);
    this.dataDirectories.set(instanceId, dataDir);
    return dataDir;
  }

  private async removeDataDirectories(instanceIds: string[]): Promise<void> {
    for (const instanceId of instanceIds) {
      const dataDir = this.dataDirectories.get(instanceId);
      if (dataDir === undefined) {
        continue;
      }
      this.dataDirectories.delete(instanceId);
      try {
        await rm(dataDir, { recursive: true, force: true, maxRetries: 3 });
        log.debug(`Removed data directory for ${instanceId}: ${dataDir}`);
      } catch (error) {
        log.warn(`Failed to remove data directory ${dataDir}: ${errorMessage(error)}`);
      }
    }
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
      await this.removeDataDirectories([`worker-${cid}`]);
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
    if (!configs) {
      return;
    }

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
        env: config.backendEnv,
        instanceId: config.instanceId,
      });
      await waitTestRunnerBackendReady(hostname, config.backendPort, 30000);

      // Store in the same location it was originally stored
      if (configs.length === 1 && config.instanceId === 'tauri-driver') {
        this.testRunnerBackend = proc;
      } else {
        this.workerBackends.set(config.instanceId, { proc, port: config.backendPort });
      }

      log.debug(`Restarting tauri-driver for ${config.instanceId} on port ${config.driverPort}`);
      await this.driverPool.startDriver({
        mode: 'multiremote',
        identifier: config.instanceId,
        port: config.driverPort,
        nativePort: config.driverNativePort,
        options: config.options,
        env: backendDriverEnv(config.backendEnv, config.backendPort),
        instanceId: config.instanceId,
      });
    }

    log.info('CrabNebula infrastructure cycled successfully');
  }

  /**
   * Complete service lifecycle
   */
  async onComplete(
    _exitCode?: number,
    _config?: Options.Testrunner,
    _capabilities?: TauriCapabilities[],
  ): Promise<void> {
    log.debug('Completing Tauri service...');

    try {
      await this.#stopDevServer?.();
      this.#stopDevServer = undefined;

      if (this.workerBackends.size > 0) {
        log.info(`Stopping ${this.workerBackends.size} worker test-runner-backend(s)...`);
        for (const [workerId, backend] of this.workerBackends) {
          await stopTestRunnerBackend(backend.proc);
          log.debug(`Stopped test-runner-backend for worker ${workerId}`);
        }
        this.workerBackends.clear();
      }

      if (this.testRunnerBackend) {
        await stopTestRunnerBackend(this.testRunnerBackend);
        this.testRunnerBackend = undefined;
      }

      const driverCleanupErrors: unknown[] = [];
      if (this.isEmbeddedMode) {
        log.info(`Stopping ${this.embeddedProcesses.size} embedded driver process(es)...`);
        for (const [key, process] of this.embeddedProcesses) {
          try {
            await stopEmbeddedDriver(process);
            this.embeddedProcesses.delete(key);
            log.debug(`Stopped embedded driver: ${key}`);
          } catch (error) {
            log.warn(`Failed to stop embedded driver ${key}: ${errorMessage(error)}`);
            driverCleanupErrors.push(error);
          }
        }
      }

      try {
        await this.driverPool.stopAll();
      } catch (error) {
        log.warn(`Failed to stop driver processes: ${errorMessage(error)}`);
        driverCleanupErrors.push(error);
      } finally {
        this.instanceOptions.clear();
        this.embeddedConfigs.clear();
        this.portManager.clear();
        this.backendPortManager.clear();
      }

      await this.removeDataDirectories([...this.dataDirectories.keys()]);

      if (driverCleanupErrors.length === 1) {
        throw driverCleanupErrors[0];
      }
      if (driverCleanupErrors.length > 1) {
        throw new AggregateError(driverCleanupErrors, 'Failed to stop driver processes', {
          cause: driverCleanupErrors[0],
        });
      }

      log.debug('Tauri service completed');
    } finally {
      // Ensure the stopped processes' shutdown output still reaches the log file.
      try {
        await closeLogWriter('tauri-service');
      } catch {
        // Log writer may not have been initialized
      }
    }
  }

  /**
   * Start tauri-driver process
   */
  private async startTauriDriver(
    port: number,
    nativePort: number,
    options: TauriServiceOptions,
    env?: NodeJS.ProcessEnv,
  ): Promise<void> {
    log.debug(`Single driver mode options: ${JSON.stringify(options, hideEnvValues, 2)}`);
    log.debug(
      `Single driver mode: captureFrontendLogs=${options.captureFrontendLogs}, captureBackendLogs=${options.captureBackendLogs}`,
    );

    if (process.platform === 'linux') {
      log.info(`Starting tauri-driver (display from environment: ${describeDisplay() ?? 'not set'})`);
    }

    await this.driverPool.startDriver({
      mode: 'single',
      identifier: 'tauri-driver',
      port,
      nativePort,
      options,
      env,
    });
  }

  /**
   * Validate CrabNebula prerequisites for macOS testing
   * Checks for CN_API_KEY and test-runner-backend availability
   */
  private async validateCrabNebulaPrerequisites(options: TauriServiceOptions): Promise<void> {
    log.info('Validating CrabNebula prerequisites for macOS...');

    // Checked in the env the backend gets, which a CN_API_KEY in the app's env would override
    if (!appEnv(options).CN_API_KEY) {
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
