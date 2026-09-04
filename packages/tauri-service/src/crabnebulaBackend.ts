import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { createLogger } from '@wdio/native-utils';
import { findTestRunnerBackend } from './driverManager.js';
import { createLogCapture } from './logCapture.js';
import type { TauriServiceOptions } from './types.js';

const log = createLogger('tauri-service');

export interface BackendProcessInfo {
  proc: ChildProcess;
  port: number;
}

export interface StartBackendOptions {
  port: number;
  serviceOptions?: TauriServiceOptions;
  instanceId?: string;
}

/**
 * Start the CrabNebula test-runner-backend process
 * Required for macOS testing with CrabNebula driver
 *
 * @param port - Port for the backend to listen on (default: 3000)
 * @param serviceOptions - Service options for log capture
 * @returns Process info including the ChildProcess and port
 * @throws Error if CN_API_KEY is not set or backend fails to start
 */
export async function startTestRunnerBackend(options: StartBackendOptions): Promise<BackendProcessInfo> {
  const { port, serviceOptions } = options;
  const backendPath = findTestRunnerBackend();

  if (!backendPath) {
    throw new Error('test-runner-backend not found. Install with: npm install -D @crabnebula/test-runner-backend');
  }

  log.info(`Found test-runner-backend at: ${backendPath}`);

  // Validate CN_API_KEY
  if (!process.env.CN_API_KEY) {
    throw new Error(
      'CN_API_KEY environment variable is required for CrabNebula macOS testing. ' +
        'Contact CrabNebula (https://crabnebula.dev) to obtain an API key.',
    );
  }

  const apiKey = process.env.CN_API_KEY;
  if (apiKey.trim() === '') {
    throw new Error(
      'CN_API_KEY environment variable is set but empty. ' + 'Please provide a valid CrabNebula API key.',
    );
  }

  // Log API key with redaction (show first 4 and last 4 chars)
  const redactedKey =
    apiKey.length > 12
      ? `${apiKey.slice(0, 4)}${'*'.repeat(Math.min(apiKey.length - 8, 20))}${apiKey.slice(-4)}`
      : `${apiKey.slice(0, 2)}${'*'.repeat(apiKey.length - 4)}${apiKey.slice(-2)}`;
  log.info(`CN_API_KEY detected: ${redactedKey} (${apiKey.length} chars)`);

  log.info(`Starting test-runner-backend on port ${port}`);

  // Kill any orphaned process still holding the port (e.g. from a previous WDIO run killed by SIGKILL)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${port}`);
  }
  try {
    if (process.platform === 'win32') {
      execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }`,
        ],
        { stdio: 'ignore' },
      );
    } else {
      const pidsOutput = execFileSync('lsof', ['-ti', `:${port}`], { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim();
      if (pidsOutput) {
        const pids = pidsOutput
          .split('\n')
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => Number.isInteger(n) && n > 0);
        for (const pid of pids) {
          process.kill(pid, 'SIGKILL');
        }
        log.info(`Killed orphaned process(es) on port ${port}: ${pids.join(', ')}`);
      }
    }
  } catch {
    // No process on port, or kill failed — port is already free
  }

  return new Promise((resolve, reject) => {
    // Use --port flag with fallback to PORT env var
    const args = ['--port', port.toString()];
    const proc = spawn(backendPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PORT: port.toString(),
      },
    });

    let settled = false;
    const safeResolve = () => {
      if (!settled) {
        settled = true;
        resolve({ proc, port });
      }
    };
    const safeReject = (error: Error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };

    // These pipes carry the app's logs for the whole test, long after startup, so
    // the reader lives as long as the backend. Readiness is the caller's
    // waitTestRunnerBackendReady() TCP poll, so spawn is signal enough to resolve.
    const captureOptions = serviceOptions ?? ({} as TauriServiceOptions);
    createLogCapture({
      stream: proc.stdout,
      identifier: 'crabnebula-backend',
      options: captureOptions,
      instanceId: options.instanceId,
    });
    createLogCapture({
      stream: proc.stderr,
      identifier: 'crabnebula-backend',
      options: captureOptions,
      instanceId: options.instanceId,
    });

    proc.once('spawn', () => {
      log.info(`test-runner-backend spawned (PID: ${proc.pid ?? 'unknown'})`);
      safeResolve();
    });

    proc.once('error', (error: Error) => {
      safeReject(new Error(`Failed to start test-runner-backend: ${error.message}`));
    });

    proc.once('exit', (code: number | null) => {
      if (code !== 0) {
        safeReject(
          new Error(
            `test-runner-backend exited with code ${code}. ` +
              'Ensure CN_API_KEY is valid and the service is accessible.',
          ),
        );
      }
    });
  });
}

/**
 * Wait for test-runner-backend HTTP endpoint to be ready
 * Polls the health endpoint until it responds
 *
 * @param port - Port the backend is listening on
 * @param timeoutMs - Maximum time to wait in milliseconds
 * @throws Error if backend doesn't become ready within timeout
 */
export async function waitTestRunnerBackendReady(
  host: string = '127.0.0.1',
  port: number = 3000,
  timeoutMs: number = 30000,
): Promise<void> {
  const net = await import('node:net');
  const started = Date.now();

  log.info(`Waiting for test-runner-backend on ${host}:${port}...`);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`test-runner-backend did not become ready within ${timeoutMs}ms`));
    }, timeoutMs);

    const checkPort = () => {
      const socket = new net.Socket();

      socket.setTimeout(1000);

      socket.on('connect', () => {
        clearTimeout(timeout);
        socket.destroy();
        log.info(`test-runner-backend ready on ${host}:${port}`);
        resolve();
      });

      socket.on('error', (err) => {
        log.debug(`Port check error: ${err.message}`);
        socket.destroy();
        // Retry after a short delay
        if (Date.now() - started < timeoutMs) {
          setTimeout(checkPort, 200);
        }
      });

      socket.on('timeout', () => {
        socket.destroy();
        // Retry after a short delay
        if (Date.now() - started < timeoutMs) {
          setTimeout(checkPort, 200);
        }
      });

      socket.connect(port, host);
    };

    checkPort();
  });
}

/**
 * Stop the test-runner-backend process
 * Sends SIGTERM first, then SIGKILL if process doesn't exit gracefully
 *
 * @param proc - The ChildProcess to stop
 * @returns Promise that resolves when process has exited
 */
export async function stopTestRunnerBackend(proc: ChildProcess): Promise<void> {
  if (proc.killed) {
    log.debug('test-runner-backend already stopped');
    return;
  }

  log.info('Stopping test-runner-backend');

  // Send SIGTERM for graceful shutdown
  proc.kill('SIGTERM');

  // Wait for graceful shutdown with timeout
  await new Promise<void>((resolve) => {
    const killTimeout = setTimeout(() => {
      if (!proc.killed) {
        log.warn('test-runner-backend did not exit gracefully, forcing kill');
        proc.kill('SIGKILL');
      }
      resolve();
    }, 5000);

    proc.on('exit', () => {
      clearTimeout(killTimeout);
      resolve();
    });
  });

  log.debug('test-runner-backend stopped');
}

/**
 * Check if test-runner-backend is healthy
 * Useful for health checks during test execution
 *
 * @param host - Host to connect to (default: 127.0.0.1)
 * @param port - Port the backend is listening on (default: 3000)
 * @returns true if backend is accepting connections
 */
export async function isTestRunnerBackendHealthy(host: string = '127.0.0.1', port: number = 3000): Promise<boolean> {
  const net = await import('node:net');

  return new Promise((resolve) => {
    const socket = new net.Socket();

    socket.setTimeout(2000);

    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });

    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, host);
  });
}
