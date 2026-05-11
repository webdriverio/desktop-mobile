import { type ChildProcess, spawn } from 'node:child_process';
import type { Interface as ReadlineInterface } from 'node:readline';
import { createLogCapture } from '@wdio/native-core';
import { createLogger } from '@wdio/native-utils';

import { forwardLog } from '../logForwarder.js';
import { parseLogLine } from '../logParser.js';
import type { DioxusServiceOptions } from '../types.js';

const log = createLogger('dioxus-service', 'launcher');

const POLL_INTERVAL_MS = 500;
const STATUS_TIMEOUT_MS = 5_000;

/** Environment variable read by `wdio-dioxus-embedded-driver` to set the server port. */
export const EMBEDDED_PORT_ENV_VAR = 'WDIO_EMBEDDED_PORT';

/** Default port used when no override is supplied. Matches the Rust crate default. */
export const DEFAULT_EMBEDDED_PORT = 4444;

export interface EmbeddedDriverInfo {
  proc: ChildProcess;
  logHandlers: ReadlineInterface[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollWebDriverStatus(port: number, timeoutMs: number): Promise<void> {
  const statusUrl = `http://127.0.0.1:${port}/status`;
  const deadline = Date.now() + timeoutMs;

  log.info(`Polling embedded WebDriver status at ${statusUrl}…`);

  while (Date.now() < deadline) {
    try {
      const response = await fetch(statusUrl, { signal: AbortSignal.timeout(STATUS_TIMEOUT_MS) });
      if (response.ok) {
        const data = (await response.json()) as { value?: { ready?: boolean } };
        if (data?.value?.ready === true) {
          log.info(`Embedded WebDriver server ready on port ${port}`);
          return;
        }
        log.debug(`Not ready yet: ${JSON.stringify(data)}`);
      }
    } catch {
      log.debug('Status poll failed, retrying…');
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(
    `Embedded WebDriver server did not become ready on port ${port} within ${timeoutMs}ms. ` +
      `Ensure wdio_dioxus_embedded_driver::install(config) is called in your app's main.rs ` +
      `(inside a #[cfg(debug_assertions)] block) and the app was built in debug mode. ` +
      `To use a different port, set embeddedPort in wdio:dioxusServiceOptions or ` +
      `the ${EMBEDDED_PORT_ENV_VAR} env var.`,
  );
}

function spawnDioxusApp(binaryPath: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  log.info(`Spawning Dioxus app: ${binaryPath} ${args.join(' ')}`);
  log.debug(`Environment: ${JSON.stringify(env, null, 2)}`);

  const child = spawn(binaryPath, args, {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  log.info(`Dioxus app spawned (PID: ${child.pid})`);
  return child;
}

/**
 * Resolve the embedded port from service options or the environment variable.
 */
export function getEmbeddedPort(options: DioxusServiceOptions): number {
  if (options.embeddedPort) {
    return options.embeddedPort;
  }
  const envPort = process.env[EMBEDDED_PORT_ENV_VAR];
  if (envPort) {
    const parsed = parseInt(envPort, 10);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return DEFAULT_EMBEDDED_PORT;
}

/**
 * Start the Dioxus app in embedded-driver mode.
 *
 * Sets `WDIO_EMBEDDED_PORT` on the child process so the embedded Axum server
 * inside the app knows which port to listen on. Polls `/status` until the
 * server signals `ready: true`, then returns the process handle.
 */
export async function startEmbeddedDriver(
  appBinaryPath: string,
  port: number,
  options: DioxusServiceOptions,
  instanceId?: string,
): Promise<EmbeddedDriverInfo> {
  const appArgs = options.appArgs ?? [];
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env,
    [EMBEDDED_PORT_ENV_VAR]: String(port),
  };

  const child = spawnDioxusApp(appBinaryPath, appArgs, env);
  const logHandlers: ReadlineInterface[] = [];
  const identifier = `embedded-${port}`;

  const makeOnLine =
    (src: 'backend' | 'frontend') =>
    (line: string, id: string | undefined): void => {
      const parsed = parseLogLine(line);
      if (!parsed) {
        return;
      }
      const minLevel = src === 'frontend' ? (options.frontendLogLevel ?? 'info') : (options.backendLogLevel ?? 'info');
      forwardLog(src, parsed.level, parsed.message, minLevel, id);
    };

  if (options.captureBackendLogs) {
    const h = createLogCapture({
      stream: child.stdout,
      identifier,
      instanceId,
      onLine: makeOnLine('backend'),
    });
    if (h) {
      logHandlers.push(h);
    }
    const errH = createLogCapture({
      stream: child.stderr,
      identifier,
      instanceId,
      onLine: makeOnLine('backend'),
    });
    if (errH) {
      logHandlers.push(errH);
    }
  }

  const cleanup = (): void => {
    for (const h of logHandlers) {
      h.close();
    }
    child.kill('SIGTERM');
  };

  const startTimeout = options.startTimeout ?? 60_000;

  const spawnErrorPromise = new Promise<never>((_, reject) => {
    child.once('error', (err) => {
      cleanup();
      reject(
        new Error(
          `Failed to spawn Dioxus app "${appBinaryPath}": ${err.message}. ` +
            `Ensure the binary exists and is executable. ` +
            `Build with \`cargo build\` (not --release) for embedded-driver support.`,
        ),
      );
    });
  });

  let exitHandler: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined;
  const earlyExitPromise = new Promise<never>((_, reject) => {
    exitHandler = (code, signal) => {
      reject(
        new Error(
          `Dioxus app exited before the embedded WebDriver server became ready ` +
            `(code=${code}, signal=${signal}). ` +
            `The app likely crashed during startup. ` +
            `Set captureBackendLogs: true in wdio:dioxusServiceOptions to see stderr.`,
        ),
      );
    };
    child.once('exit', exitHandler);
  });

  const readyPromise = pollWebDriverStatus(port, startTimeout);

  try {
    await Promise.race([readyPromise, spawnErrorPromise, earlyExitPromise]);
  } catch (error) {
    cleanup();
    throw error;
  } finally {
    if (exitHandler) {
      child.removeListener('exit', exitHandler);
    }
  }

  return { proc: child, logHandlers };
}

/**
 * Stop an embedded driver: close log handlers then SIGTERM the process,
 * falling back to SIGKILL after 5 s.
 */
export async function stopEmbeddedDriver(info: EmbeddedDriverInfo): Promise<void> {
  for (const h of info.logHandlers) {
    try {
      h.close();
    } catch {
      // ignore
    }
  }

  if (!info.proc.pid) {
    return;
  }

  log.info(`Stopping embedded driver (PID: ${info.proc.pid})…`);
  info.proc.kill('SIGTERM');

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (info.proc.exitCode !== null || info.proc.signalCode !== null) {
      log.info('Embedded driver exited gracefully');
      return;
    }
    await sleep(100);
  }

  log.warn('Embedded driver did not exit gracefully, sending SIGKILL');
  info.proc.kill('SIGKILL');
}

/**
 * Check whether the embedded server is still alive on the given port.
 */
export async function checkEmbeddedServerAlive(port: number, timeoutMs = 2_000): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/status`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}
