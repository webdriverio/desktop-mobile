// Generic driver subprocess lifecycle.
//
// Extracted from packages/tauri-service/src/driverProcess.ts. Generalised so
// both `wdio-tauri-service` (tauri-driver) and `wdio-dioxus-service`
// (wdio-dioxus-driver) can use it without subclassing.
//
// Tauri-isms scrubbed:
//   - `tauriDriverPath` → `driverPath`.
//   - `TauriServiceOptions` import removed; log forwarding is now injected
//     via the `onLogLine` callback (caller decides parser + forwarder).
//   - Log strings parameterised on `driverName` (default 'driver'); callers
//     pass 'tauri-driver' or 'wdio-dioxus-driver' to keep diagnostics
//     readable.
//   - `startupMarkers` / `errorMarkers` moved out of the file's defaults
//     into the caller's `DriverStartOptions` so each service supplies its
//     own (we used to hardcode Tauri's strings).
//
// The poll-for-readiness behaviour (TCP open + HTTP /status reachable),
// SIGTERM-then-SIGKILL shutdown sequence, and CI-aware timeouts all
// transfer unchanged — they're generic.

import { type ChildProcess, spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import type { Interface as ReadlineInterface } from 'node:readline';

import { createLogger } from '@wdio/native-utils';

import { createLogCapture } from './logCapture.js';

const log = createLogger('native-core', 'launcher');

export interface DriverStartOptions {
  mode: 'single' | 'worker' | 'multiremote';
  identifier: string;
  port: number;
  nativePort: number;
  driverPath: string;
  nativeDriverPath?: string;
  env?: NodeJS.ProcessEnv;
  dataDir?: string;
  instanceId?: string;
  /**
   * Driver-specific identifier used in log messages and error strings
   * (e.g. 'tauri-driver', 'wdio-dioxus-driver'). Defaults to 'driver'.
   */
  driverName?: string;
  /**
   * Called for each stdout/stderr line from the driver subprocess. The
   * caller is responsible for parsing + forwarding via its own
   * service-specific pipeline.
   */
  onLogLine?: (line: string, instanceId: string | undefined) => void;
  /**
   * Substrings indicating the driver has started successfully (e.g.
   * `['tauri-driver started', 'listening on']`). Optional — poll-for-readiness
   * works without these markers, but they short-circuit the TCP/HTTP poll
   * loop when present.
   */
  startupMarkers?: readonly string[];
  /**
   * Substrings indicating a fatal driver bind error (e.g.
   * `['can not listen']`). When matched, the start() promise rejects.
   */
  errorMarkers?: readonly string[];
}

export interface DriverProcessInfo {
  proc: ChildProcess;
  port: number;
  nativePort: number;
  dataDir?: string;
}

/**
 * Manages a single driver subprocess lifecycle (Tauri's tauri-driver,
 * Dioxus's wdio-dioxus-driver, or any other WebDriver proxy).
 */
export class DriverProcess {
  private _proc?: ChildProcess;
  private streamHandlers: ReadlineInterface[] = [];
  private startupTimeout?: ReturnType<typeof setTimeout>;
  private pollTimer?: ReturnType<typeof setTimeout>;
  private readonly startTimeout = 30000; // 30 seconds
  private _port?: number;
  private _nativePort?: number;
  private _dataDir?: string;

  get proc(): ChildProcess | undefined {
    return this._proc;
  }

  get port(): number | undefined {
    return this._port;
  }

  get nativePort(): number | undefined {
    return this._nativePort;
  }

  get dataDir(): string | undefined {
    return this._dataDir;
  }

  async start(options: DriverStartOptions): Promise<DriverProcessInfo> {
    const {
      identifier,
      port,
      nativePort,
      driverPath,
      nativeDriverPath,
      env,
      onLogLine,
      startupMarkers,
      errorMarkers,
      instanceId,
    } = options;
    const driverName = options.driverName ?? 'driver';

    this._port = port;
    this._nativePort = nativePort;
    this._dataDir = options.dataDir;

    log.info(`Starting ${driverName} [${identifier}] on port ${port} (native port: ${nativePort})`);

    const args = ['--port', port.toString(), '--native-port', nativePort.toString()];

    if (nativeDriverPath) {
      args.push('--native-driver', nativeDriverPath);
      log.debug(`[${identifier}] Using native driver: ${nativeDriverPath}`);
    }

    return new Promise<DriverProcessInfo>((resolve, reject) => {
      let settled = false;

      const safeResolve = (info: DriverProcessInfo) => {
        if (!settled) {
          settled = true;
          this.cleanupTimeout();
          resolve(info);
        }
      };

      const safeReject = (err: Error) => {
        if (!settled) {
          settled = true;
          this.cleanupTimeout();
          this.cleanup();
          reject(err);
        }
      };

      try {
        const spawnEnv = env ? { ...process.env, ...env } : process.env;

        this._proc = spawn(driverPath, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: false,
          env: spawnEnv,
          shell: process.platform === 'win32',
        });

        log.info(`[${identifier}] Spawned process with PID: ${this._proc.pid ?? 'unknown'}`);

        this.startupTimeout = setTimeout(() => {
          if (!settled) {
            safeReject(new Error(`${driverName} [${identifier}] failed to start within ${this.startTimeout}ms`));
          }
        }, this.startTimeout);

        const noop = () => {
          /* caller didn't wire log capture */
        };

        const stdoutHandler = createLogCapture({
          stream: this._proc.stdout,
          identifier,
          instanceId,
          startupMarkers,
          errorMarkers,
          onErrorDetected: (message: string) => safeReject(new Error(message)),
          onLine: onLogLine ?? noop,
        });

        const stderrHandler = createLogCapture({
          stream: this._proc.stderr,
          identifier,
          instanceId,
          startupMarkers,
          errorMarkers,
          onErrorDetected: (message: string) => safeReject(new Error(message)),
          onLine: onLogLine ?? noop,
        });

        if (stdoutHandler) this.streamHandlers.push(stdoutHandler);
        if (stderrHandler) this.streamHandlers.push(stderrHandler);

        this._proc.once('exit', (code, signal) => {
          if (!settled) {
            safeReject(
              new Error(
                `${driverName} [${identifier}] exited unexpectedly during startup (code: ${code}, signal: ${signal})`,
              ),
            );
          }
        });

        this._proc.once('error', (err) => {
          safeReject(new Error(`${driverName} [${identifier}] failed to start: ${err.message}`));
        });

        this.pollForReadiness(driverName, identifier, port, nativePort, options.dataDir, safeResolve, safeReject);
      } catch (error) {
        safeReject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private async pollForReadiness(
    driverName: string,
    identifier: string,
    port: number,
    nativePort: number,
    dataDir: string | undefined,
    resolve: (info: DriverProcessInfo) => void,
    reject: (err: Error) => void,
  ): Promise<void> {
    const startTime = Date.now();
    const timeout = 10000;
    const pollInterval = 100;

    const poll = async () => {
      if (!this._proc || this._proc.killed) {
        reject(new Error(`${driverName} [${identifier}] process died during startup`));
        return;
      }

      if (Date.now() - startTime > timeout) {
        reject(new Error(`${driverName} [${identifier}] failed to become ready within ${timeout}ms`));
        return;
      }

      const isPortOpen = await this.isPortOpen(port, 500);

      if (isPortOpen) {
        try {
          await this.waitForHttpReady(port, 1000);
          log.info(`✅ ${driverName} [${identifier}] is ready on port ${port}`);
          resolve({
            proc: this._proc,
            port,
            nativePort,
            dataDir,
          });
          return;
        } catch {
          // Port open, HTTP not ready yet — keep polling.
        }
      }

      this.pollTimer = setTimeout(poll, pollInterval);
    };

    poll();
  }

  private async isPortOpen(port: number, timeout: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let settled = false;

      const cleanup = () => {
        if (!settled) {
          settled = true;
          socket.destroy();
        }
      };

      socket.setTimeout(timeout);
      socket.once('error', () => {
        cleanup();
        resolve(false);
      });
      socket.once('timeout', () => {
        cleanup();
        resolve(false);
      });

      socket.connect(port, '127.0.0.1', () => {
        cleanup();
        resolve(true);
      });
    });
  }

  private async waitForHttpReady(port: number, timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = http.get(`http://127.0.0.1:${port}/status`, (res) => {
        res.resume();
        request.destroy();
        resolve();
      });

      request.setTimeout(timeout, () => {
        request.destroy();
        reject(new Error('HTTP request timeout'));
      });

      request.on('error', (err) => {
        request.destroy();
        reject(err);
      });
    });
  }

  async stop(driverName = 'driver'): Promise<void> {
    if (!this._proc || this._proc.killed) {
      return;
    }

    // Process already exited naturally (crash or normal exit). `killed` is only
    // set by an explicit `.kill()` call, so the guard above misses this case —
    // without the early return, SIGTERM is a no-op and waitForExit() hangs for
    // the full stopTimeout + 5s SIGKILL grace because the `exit` event already
    // fired before this listener was attached.
    if (this._proc.exitCode !== null || this._proc.signalCode !== null) {
      log.debug(`${driverName} already exited (code=${this._proc.exitCode}, signal=${this._proc.signalCode})`);
      this.cleanup();
      return;
    }

    log.debug(`Stopping ${driverName}...`);
    this._proc.kill('SIGTERM');

    await this.waitForExit(driverName);
    this.cleanup();

    // Additional delay to ensure the port is fully released.
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
  }

  isRunning(): boolean {
    if (!this._proc) {
      return false;
    }
    // `.killed` is only set by explicit subprocess.kill() calls. A process that
    // exited naturally (crash / normal exit) has killed=false but exitCode or
    // signalCode set, so checking only `.killed` reports a dead process as
    // running. See the matching guard in stop().
    if (this._proc.exitCode !== null || this._proc.signalCode !== null) {
      return false;
    }
    return !this._proc.killed;
  }

  private async waitForExit(driverName: string): Promise<void> {
    const stopTimeout = process.env.CI ? 10000 : 5000;

    return new Promise<void>((resolve) => {
      let shutdownTimeout: ReturnType<typeof setTimeout> | null = null;
      let killTimeout: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (shutdownTimeout) clearTimeout(shutdownTimeout);
        if (killTimeout) clearTimeout(killTimeout);
      };

      const onExit = () => {
        cleanup();
        log.debug(`${driverName} process exited`);
        resolve();
      };

      this._proc?.once('exit', onExit);

      shutdownTimeout = setTimeout(() => {
        log.warn(`${driverName} did not stop gracefully after ${stopTimeout}ms, forcing kill`);
        this._proc?.kill('SIGKILL');

        killTimeout = setTimeout(() => {
          log.warn(`${driverName} force kill timeout, giving up`);
          cleanup();
          resolve();
        }, 5000);
      }, stopTimeout);
    });
  }

  private cleanup(): void {
    this.cleanupTimeout();

    for (const handler of this.streamHandlers) {
      handler.close();
    }
    this.streamHandlers = [];

    if (this._proc) {
      this._proc.removeAllListeners('exit');
      this._proc.removeAllListeners('error');
    }
  }

  private cleanupTimeout(): void {
    if (this.startupTimeout) {
      clearTimeout(this.startupTimeout);
      this.startupTimeout = undefined;
    }
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
  }
}
