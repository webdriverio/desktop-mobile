import { type ChildProcess, spawn } from 'node:child_process';
import type { Interface as ReadlineInterface } from 'node:readline';
import { setTimeout as sleep } from 'node:timers/promises';
import { createLogger } from '@wdio/native-utils';
import { throwIfAborted } from './errors.js';
import { createLogCapture } from './logCapture.js';
import type { TauriServiceOptions } from './types.js';

const log = createLogger('tauri-service', 'launcher');

async function pollWebDriverStatus(port: number, signal: AbortSignal): Promise<void> {
  const statusUrl = `http://127.0.0.1:${port}/status`;
  log.debug(`Polling WebDriver status at ${statusUrl}...`);

  let attempt = 0;
  while (true) {
    throwIfAborted(signal);
    const request = new AbortController();
    const onAbort = () => request.abort(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => request.abort(), 5000);
    try {
      const response = await fetch(statusUrl, { signal: request.signal });
      if (response.ok) {
        const data = (await response.json()) as { value?: { ready?: boolean } };
        throwIfAborted(signal);
        if (data?.value?.ready === true) {
          log.info(`WebDriver server ready on port ${port}`);
          return;
        }
      } else {
        await response.body?.cancel();
      }
    } catch {
      throwIfAborted(signal);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }
    if (attempt++ % 10 === 0) {
      log.debug(`WebDriver server not ready yet (attempt ${attempt}), retrying...`);
    }
    await sleep(500, undefined, { signal });
  }
}

/**
 * Spawn the Tauri app directly (no external driver)
 */
function spawnTauriApp(appBinaryPath: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  log.debug(`Spawning Tauri app: ${appBinaryPath} ${args.join(' ')}`);
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
  abortSignal?: AbortSignal,
): Promise<EmbeddedDriverInfo> {
  throwIfAborted(abortSignal);
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

  const logHandlers: ReadlineInterface[] = [];
  const startup = new AbortController();
  const onAbort = () => startup.abort(abortSignal?.reason);
  abortSignal?.addEventListener('abort', onAbort, { once: true });
  if (abortSignal?.aborted) onAbort();

  const startTimeout = options.startTimeout || 60000;
  const timer = setTimeout(
    () =>
      startup.abort(
        new Error(
          `Embedded WebDriver server did not become ready on port ${port} within ${startTimeout}ms. ` +
            `If you have installed tauri-plugin-wdio-webdriver, ensure it is registered in your Tauri app: ` +
            `app.plugin(tauri_plugin_wdio_webdriver::init()) in lib.rs. ` +
            `If you are not using the embedded plugin, set driverProvider: 'external' in your service options. ` +
            `To use a different port, set embeddedPort in your service options or the TAURI_WEBDRIVER_PORT env var.`,
        ),
      ),
    startTimeout,
  );
  const onError = (error: Error) =>
    startup.abort(
      new Error(
        `Failed to spawn Tauri app "${appBinaryPath}": ${error.message}. ` +
          `Ensure the application binary exists and is executable. ` +
          `If you are not using the embedded plugin, set driverProvider: 'external' in your service options.`,
        { cause: error },
      ),
    );
  const onExit = (code: number | null, signal: NodeJS.Signals | null) =>
    startup.abort(
      new Error(
        `Tauri app exited before the embedded WebDriver server became ready ` +
          `(code=${code}, signal=${signal}). ` +
          `The app likely crashed during startup. ` +
          `Set captureBackendLogs: true in wdio:tauriServiceOptions to see the app's stderr.`,
      ),
    );
  child.once('error', onError);
  child.once('exit', onExit);

  try {
    for (const stream of [child.stdout, child.stderr]) {
      const handler = createLogCapture({ stream, identifier: `embedded-${port}`, options, instanceId });
      if (handler) logHandlers.push(handler);
    }
    await pollWebDriverStatus(port, startup.signal);
    if (process.platform === 'win32') {
      await sleep(500, undefined, { signal: startup.signal });
    }
    throwIfAborted(startup.signal);
  } catch (error) {
    startup.abort(error);
    const cause =
      startup.signal.reason instanceof Error
        ? startup.signal.reason
        : new Error('Tauri WebDriver lifecycle aborted', { cause: startup.signal.reason });
    try {
      await stopEmbeddedDriver({ proc: child, logHandlers });
    } catch (cleanupError) {
      throw new AggregateError([cause, cleanupError], 'Embedded WebDriver startup and cleanup failed', { cause });
    }
    throw cause;
  } finally {
    clearTimeout(timer);
    abortSignal?.removeEventListener('abort', onAbort);
    child.removeListener('error', onError);
    child.removeListener('exit', onExit);
  }

  return { proc: child, logHandlers };
}

/**
 * Stop the embedded driver (kill the app process and close log handlers)
 *
 * Uses event-based waits (no setTimeout poll loop) and explicitly destroys
 * the child's stdio streams before signalling, so libuv has no dangling
 * stream/timer handles when WDIO tears down the event loop. Without this,
 * Windows runs intermittently hit `Assertion failed: !(handle->flags &
 * UV_HANDLE_CLOSING)` in `src/win/async.c` after a successful test.
 */
export async function stopEmbeddedDriver(info: EmbeddedDriverInfo): Promise<void> {
  const { proc: child, logHandlers } = info;

  // Detach readline interfaces first: removes all listeners synchronously so
  // no further 'line' events fire while the underlying pipes are tearing down.
  for (const handler of logHandlers) {
    try {
      handler.removeAllListeners();
    } catch {
      // Ignore — best-effort detach
    }
    try {
      handler.close();
    } catch {
      // Ignore errors on close
    }
  }

  // Explicitly destroy stdout/stderr streams. Killing the process closes the
  // OS pipe, but Node's readable wrapper keeps a libuv pipe handle around
  // until something destroys or fully drains it — destroying it here ensures
  // the handle is released on a known tick rather than during loop teardown.
  for (const stream of [child.stdout, child.stderr]) {
    if (stream && !stream.destroyed) {
      try {
        stream.removeAllListeners();
        stream.destroy();
      } catch {
        // Ignore errors on destroy
      }
    }
  }

  if (!child.pid) {
    log.debug('No PID available for embedded driver');
    return;
  }

  log.debug(`Stopping embedded driver (PID: ${child.pid})...`);

  // If the process has already exited (e.g. crashed during teardown), skip the
  // signal dance entirely.
  if (child.exitCode !== null || child.signalCode !== null) {
    log.debug('Embedded driver already exited');
    return;
  }

  if (await signalAndWaitForExit(child, 'SIGTERM', 5000)) {
    log.debug('Embedded driver exited gracefully');
    return;
  }

  log.warn('Embedded driver did not exit gracefully, forcing kill...');
  if (!(await signalAndWaitForExit(child, 'SIGKILL', 1000))) {
    throw new Error(`Embedded driver process ${child.pid} did not exit after SIGKILL`);
  }
}

function signalAndWaitForExit(child: ChildProcess, signal: NodeJS.Signals, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      child.removeListener('error', onError);
    };
    const onExit = () => {
      cleanup();
      resolve(true);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);
    timer.unref();
    // Register before kill: a child can exit as soon as the signal is sent.
    child.once('exit', onExit);
    child.once('error', onError);
    try {
      child.kill(signal);
      if (child.exitCode !== null || child.signalCode !== null) onExit();
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

/**
 * Check if the embedded WebDriver server is reachable on the given port
 */
export async function checkEmbeddedServerAlive(
  port: number,
  timeoutMs: number = 2000,
  abortSignal?: AbortSignal,
): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/status`, {
      signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(abortSignal ? [abortSignal] : [])]),
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
