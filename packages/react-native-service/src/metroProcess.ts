// Metro dev-server lifecycle (opt-in) — owns `react-native start` the way
// @wdio/electron-service owns chromedriver. Starts Metro as a long-lived child, polls its
// `/status` endpoint for readiness, optionally pre-bundles to warm the cold compile, and
// tears it down on onComplete. One shared Metro serves all workers (the worker-side
// MetroBridge connects to it and does the per-device `adb reverse`), so this lives in the
// launcher's main process — never per worker.
//
// Mirrors the SIGTERM→SIGKILL shutdown discipline of native-core's DriverProcess; Metro's
// arg shape (`start --port`) and `/status` readiness don't fit DriverProcess.start(), so
// the process handling is local but the lifecycle semantics are the same.

import { type ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import { createLogger } from '@wdio/native-utils';

import { DEFAULT_METRO_PORT, SERVICE_NAME } from './constants.js';

const log = createLogger(SERVICE_NAME, 'launcher');

const isWindows = process.platform === 'win32';

export interface MetroStartOptions {
  /** App project root that `react-native start` runs in. Default `process.cwd()`. */
  projectRoot?: string;
  /** Metro port. Default 8081. */
  port?: number;
  /** Platform for the optional pre-bundle request. */
  platform?: 'android' | 'ios';
  /** Pre-bundle (`/index.bundle`) after ready to warm the ~60s cold compile. Default off. */
  prebundle?: boolean;
  /** Readiness budget (ms). Default 180s in CI, 120s locally. */
  readyTimeoutMs?: number;
  /** Readiness poll interval (ms). Default 500. */
  pollIntervalMs?: number;
}

/** A one-shot readiness probe — resolves true when Metro answers `/status`. */
export type MetroReadyProbe = (port: number) => Promise<boolean>;
/** A best-effort pre-bundle fetch. */
export type MetroBundleFetch = (port: number, platform: 'android' | 'ios') => Promise<void>;

/** Resolve the project's `react-native` CLI; fall back to the project-local `npx`. */
export function resolveReactNativeBin(projectRoot: string): { cmd: string; prefixArgs: string[] } {
  const localBin = isWindows
    ? join(projectRoot, 'node_modules', '.bin', 'react-native.cmd')
    : join(projectRoot, 'node_modules', '.bin', 'react-native');
  if (existsSync(localBin)) {
    return { cmd: localBin, prefixArgs: [] };
  }
  // --no-install so a missing CLI fails fast instead of fetching from the registry mid-run.
  return { cmd: isWindows ? 'npx.cmd' : 'npx', prefixArgs: ['--no-install', 'react-native'] };
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Default readiness probe: Metro answers `GET /status` with 200 once the bundler is up. */
export const probeMetroStatus: MetroReadyProbe = (port) =>
  new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/status`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });

const defaultFetchBundle: MetroBundleFetch = (port, platform) =>
  new Promise((resolve, reject) => {
    const url = `http://127.0.0.1:${port}/index.bundle?platform=${platform}&dev=true&minify=false`;
    const req = http.get(url, (res) => {
      res.resume();
      res.statusCode === 200 ? resolve() : reject(new Error(`bundle request returned ${res.statusCode}`));
    });
    // Best-effort warm-up: cap at 60s so a slow/stuck bundle can't hold up onPrepare for
    // the full 5 minutes a cold compile might otherwise allow.
    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error('bundle request timeout'));
    });
    req.on('error', reject);
  });

export class MetroProcess {
  #proc?: ChildProcess;
  #port = DEFAULT_METRO_PORT;
  // A spawn 'error' (e.g. ENOENT — the CLI isn't installed) leaves exitCode/signalCode null,
  // so the readiness loop would otherwise spin to the full timeout. Capture it to fail fast.
  #spawnError?: Error;
  readonly #spawn: typeof nodeSpawn;
  readonly #probe: MetroReadyProbe;
  readonly #fetchBundle: MetroBundleFetch;

  constructor(deps: { spawn?: typeof nodeSpawn; probe?: MetroReadyProbe; fetchBundle?: MetroBundleFetch } = {}) {
    this.#spawn = deps.spawn ?? nodeSpawn;
    this.#probe = deps.probe ?? probeMetroStatus;
    this.#fetchBundle = deps.fetchBundle ?? defaultFetchBundle;
  }

  get port(): number {
    return this.#port;
  }

  isRunning(): boolean {
    // A failed spawn (ENOENT) fires 'error' but leaves exitCode/signalCode/killed in their
    // initial "never started" state, so guard on #spawnError before those checks.
    if (this.#spawnError) {
      return false;
    }
    const p = this.#proc;
    if (!p) {
      return false;
    }
    if (p.exitCode !== null || p.signalCode !== null) {
      return false;
    }
    return !p.killed;
  }

  async start(options: MetroStartOptions = {}): Promise<void> {
    const projectRoot = options.projectRoot ?? process.cwd();
    const port = options.port ?? DEFAULT_METRO_PORT;
    this.#port = port;
    this.#spawnError = undefined;

    const { cmd, prefixArgs } = resolveReactNativeBin(projectRoot);
    log.info(`Starting Metro on port ${port} (cwd: ${projectRoot})`);
    const proc = this.#spawn(cmd, [...prefixArgs, 'start', '--port', String(port)], {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    this.#proc = proc;
    proc.stdout?.on('data', (d: Buffer) => log.debug(`[metro] ${d.toString().trim()}`));
    proc.stderr?.on('data', (d: Buffer) => log.debug(`[metro] ${d.toString().trim()}`));
    proc.on('error', (e) => {
      this.#spawnError = e;
      log.error(`Metro spawn error: ${e.message}`);
    });

    await this.#waitForReady(port, options);

    if (options.prebundle) {
      try {
        await this.#fetchBundle(port, options.platform ?? 'android');
        log.info('Metro bundle pre-built');
      } catch (error) {
        log.warn(`Metro pre-bundle failed (continuing): ${(error as Error).message}`);
      }
    }
  }

  async #waitForReady(port: number, options: MetroStartOptions): Promise<void> {
    const timeout = options.readyTimeoutMs ?? (process.env.CI ? 180000 : 120000);
    const interval = options.pollIntervalMs ?? 500;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (this.#spawnError) {
        throw new Error(`Metro failed to start: ${this.#spawnError.message}`);
      }
      const p = this.#proc;
      if (p && (p.exitCode !== null || p.signalCode !== null)) {
        throw new Error('Metro process exited during startup');
      }
      if (await this.#probe(port)) {
        // A spawn 'error' may have fired during the probe await; a pre-existing Metro already
        // on this port would still answer, so re-check before claiming we started it. The
        // assertion defeats the stale CFA narrowing from the loop-top guard above.
        const spawnError = this.#spawnError as Error | undefined;
        if (spawnError) {
          throw new Error(`Metro failed to start: ${spawnError.message}`);
        }
        log.info(`Metro ready on port ${port}`);
        return;
      }
      await delay(interval);
    }
    throw new Error(`Metro did not become ready within ${timeout}ms on port ${port}`);
  }

  async stop(): Promise<void> {
    const proc = this.#proc;
    if (!proc || proc.killed) {
      return;
    }
    if (this.#spawnError) {
      // Spawn failed (ENOENT): Node fired 'error' but never will fire 'exit', so
      // #waitForExit would hang to the SIGKILL grace. There's no live process to kill —
      // just drop the handle.
      this.#proc = undefined;
      return;
    }
    if (proc.exitCode !== null || proc.signalCode !== null) {
      this.#proc = undefined;
      return;
    }
    log.debug('Stopping Metro...');
    proc.kill('SIGTERM');
    await this.#waitForExit(proc);
    this.#proc = undefined;
  }

  #waitForExit(proc: ChildProcess): Promise<void> {
    const stopTimeout = process.env.CI ? 10000 : 5000;
    return new Promise<void>((resolve) => {
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const graceTimer = setTimeout(() => {
        log.warn(`Metro did not stop gracefully after ${stopTimeout}ms, forcing kill`);
        proc.kill('SIGKILL');
        killTimer = setTimeout(resolve, 5000);
      }, stopTimeout);
      proc.once('exit', () => {
        clearTimeout(graceTimer);
        if (killTimer) {
          clearTimeout(killTimer);
        }
        resolve();
      });
    });
  }
}
