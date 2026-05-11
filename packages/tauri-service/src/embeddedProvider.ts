import { type ChildProcess, spawn } from 'node:child_process';
import type { Interface as ReadlineInterface } from 'node:readline';
import { createLogger } from '@wdio/native-utils';
import { createLogCapture } from './logCapture.js';
import type { TauriServiceOptions } from './types.js';

const log = createLogger('tauri-service', 'launcher');

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll the WebDriver status endpoint until ready or timeout
 */
async function pollWebDriverStatus(port: number, timeoutMs: number = 30000): Promise<void> {
  const startTime = Date.now();
  const statusUrl = `http://127.0.0.1:${port}/status`;

  log.info(`Polling WebDriver status at ${statusUrl}...`);

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(statusUrl, { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        const data = (await response.json()) as { value?: { ready?: boolean } };
        // W3C WebDriver status response: { value: { ready: boolean } }
        if (data?.value?.ready === true) {
          log.info(`✅ WebDriver server ready on port ${port}`);
          return;
        }
        log.debug(`WebDriver server not ready yet: ${JSON.stringify(data)}`);
      }
    } catch {
      // Connection refused or timeout - server not ready yet
      log.debug(`WebDriver status poll failed, retrying...`);
    }

    await sleep(500);
  }

  throw new Error(
    `Embedded WebDriver server did not become ready on port ${port} within ${timeoutMs}ms. ` +
      `If you have installed tauri-plugin-wdio-webdriver, ensure it is registered in your Tauri app: ` +
      `app.plugin(tauri_plugin_wdio_webdriver::init()) in lib.rs. ` +
      `If you are not using the embedded plugin, set driverProvider: 'external' in your service options. ` +
      `To use a different port, set embeddedPort in your service options or the TAURI_WEBDRIVER_PORT env var.`,
  );
}

/**
 * Spawn the Tauri app directly (no external driver)
 */
function spawnTauriApp(appBinaryPath: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  log.info(`Spawning Tauri app: ${appBinaryPath} ${args.join(' ')}`);
  log.debug(`Environment: ${JSON.stringify(env, null, 2)}`);

  const child = spawn(appBinaryPath, args, {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  log.info(`Tauri app spawned (PID: ${child.pid})`);

  return child;
}

export interface EmbeddedDriverInfo {
  proc: ChildProcess;
  logHandlers: ReadlineInterface[];
}

/**
 * Start the embedded WebDriver provider
 * Spawns the Tauri app directly and polls for the embedded WebDriver server
 */
export async function startEmbeddedDriver(
  appBinaryPath: string,
  port: number,
  options: TauriServiceOptions,
  instanceId?: string,
): Promise<EmbeddedDriverInfo> {
  const appArgs = options.appArgs || [];

  // Set TAURI_WEBDRIVER_PORT env var to configure the embedded server port
  // Set WDIO_EMBEDDED_SERVER to signal the app to load tauri-plugin-wdio-server
  const env = {
    ...process.env,
    ...options.env,
    TAURI_WEBDRIVER_PORT: String(port),
    WDIO_EMBEDDED_SERVER: 'true',
  };

  // Spawn the app directly
  const child = spawnTauriApp(appBinaryPath, appArgs, env);

  // Set up log handlers for stdout/stderr
  const logHandlers: ReadlineInterface[] = [];
  const identifier = `embedded-${port}`;

  const stdoutHandler = createLogCapture({
    stream: child.stdout,
    identifier,
    options,
    instanceId,
  });
  if (stdoutHandler) logHandlers.push(stdoutHandler);

  const stderrHandler = createLogCapture({
    stream: child.stderr,
    identifier,
    options,
    instanceId,
  });
  if (stderrHandler) logHandlers.push(stderrHandler);

  // Helper to clean up resources
  const cleanup = () => {
    for (const handler of logHandlers) {
      handler.close();
    }
    child.kill('SIGTERM');
  };

  // Wait for the embedded WebDriver server to be ready
  // Use 60s timeout for CI environments where apps can take longer to start
  const startTimeout = options.startTimeout || 60000;

  // Create a promise that rejects on spawn error (e.g., ENOENT)
  const spawnErrorPromise = new Promise<never>((_, reject) => {
    child.once('error', (err) => {
      cleanup();
      reject(
        new Error(
          `Failed to spawn Tauri app "${appBinaryPath}": ${err.message}. ` +
            `Ensure the application binary exists and is executable. ` +
            `If you are not using the embedded plugin, set driverProvider: 'external' in your service options.`,
        ),
      );
    });
  });

  // Reject if the app exits before the WebDriver server becomes ready.
  // Without this, a crashed/early-exiting app shows up as a generic poll timeout
  // with no exit code or signal, leaving the user with no signal to debug.
  let exitHandler: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined;
  const earlyExitPromise = new Promise<never>((_, reject) => {
    exitHandler = (code, signal) => {
      reject(
        new Error(
          `Tauri app exited before the embedded WebDriver server became ready ` +
            `(code=${code}, signal=${signal}). ` +
            `The app likely crashed during startup. ` +
            `Set captureBackendLogs: true in wdio:tauriServiceOptions to see the app's stderr.`,
        ),
      );
    };
    child.once('exit', exitHandler);
  });

  // Create a promise that resolves when the server is ready
  const readyPromise = pollWebDriverStatus(port, startTimeout).then(async () => {
    // On Windows, add a small delay after ready to allow WebView2 to fully stabilize
    if (process.platform === 'win32') {
      await sleep(500);
    }
  });

  try {
    // Race between ready, spawn error, early exit, and timeout
    await Promise.race([readyPromise, spawnErrorPromise, earlyExitPromise]);
  } catch (error) {
    cleanup();
    throw error;
  } finally {
    // Detach the exit listener so a normal later exit doesn't surface as an unhandled rejection
    if (exitHandler) {
      child.removeListener('exit', exitHandler);
    }
  }

  return { proc: child, logHandlers };
}

/**
 * Stop the embedded driver (kill the app process and close log handlers)
 */
export async function stopEmbeddedDriver(info: EmbeddedDriverInfo): Promise<void> {
  const { proc: child, logHandlers } = info;

  // Close log handlers first
  for (const handler of logHandlers) {
    try {
      handler.close();
    } catch {
      // Ignore errors on close
    }
  }

  if (!child.pid) {
    log.debug('No PID available for embedded driver');
    return;
  }

  log.info(`Stopping embedded driver (PID: ${child.pid})...`);

  // Try graceful shutdown first (SIGTERM)
  child.kill('SIGTERM');

  // Wait for process to exit
  const gracefulTimeout = 5000;
  const startTime = Date.now();

  while (Date.now() - startTime < gracefulTimeout) {
    if (child.exitCode !== null || child.signalCode !== null) {
      log.info(`✅ Embedded driver exited gracefully`);
      return;
    }
    await sleep(100);
  }

  // Force kill if still running
  log.warn('Embedded driver did not exit gracefully, forcing kill...');
  child.kill('SIGKILL');
}

/**
 * Check if the embedded WebDriver server is reachable on the given port
 */
export async function checkEmbeddedServerAlive(port: number, timeoutMs: number = 2000): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/status`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Check if embedded provider should be used
 * Returns true when no driverProvider is configured (embedded is the default)
 */
export function isEmbeddedProvider(options: TauriServiceOptions): boolean {
  if (options.driverProvider) {
    return options.driverProvider === 'embedded';
  }
  return true;
}

/**
 * Get the embedded port from options or env var
 * Defaults to 4445
 */
export function getEmbeddedPort(options: TauriServiceOptions): number {
  // Priority: 1. embeddedPort option, 2. TAURI_WEBDRIVER_PORT env var, 3. default 4445
  if (options.embeddedPort) {
    return options.embeddedPort;
  }
  const envPort = process.env.TAURI_WEBDRIVER_PORT;
  if (envPort) {
    const port = parseInt(envPort, 10);
    if (!Number.isNaN(port)) {
      return port;
    }
  }
  return 4445;
}
