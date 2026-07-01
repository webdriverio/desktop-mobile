// Dev-server lifecycle for browser mode (opt-in) — spawns a user command (e.g. `pnpm dev`), polls
// `devServerUrl` for readiness, and tears the process *tree* down. Mirrors the SIGTERM→SIGKILL
// discipline of native-core's DriverProcess / react-native-service's MetroProcess, but a free-form
// shell command + a full-URL readiness probe don't fit DriverProcess.start()'s fixed arg shape, so
// the process handling is local. Unlike those, a shell-spawned dev server spawns grandchildren
// (`pnpm dev` → vite → esbuild), so teardown kills the process group, not just the direct child.

import { type ChildProcess, spawn as nodeSpawn } from 'node:child_process';
import { createLogger } from '@wdio/native-utils';

const log = createLogger('native-core', 'launcher');

const isWindows = process.platform === 'win32';
const DEFAULT_READY_TIMEOUT_MS = 60_000;
const CI_READY_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_MS = 500;
const DEFAULT_PROBE_TIMEOUT_MS = 3_000;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A reachability probe — resolves `true` once the dev server answers at `url`. */
export type DevServerReadyProbe = (url: string) => Promise<boolean>;

/** Kill a spawned child (and, where possible, its process group) with `signal`. */
export type DevServerKill = (proc: ChildProcess, signal: NodeJS.Signals) => void;

export interface DevServerStartOptions {
  /** Command run in a shell to start the dev server, e.g. `'pnpm dev'`. */
  command: string;
  /** Working directory. Default `process.cwd()`. */
  cwd?: string;
  /** Extra environment variables, merged over `process.env`. */
  env?: Record<string, string>;
  /** Readiness target — the URL polled until reachable (i.e. `devServerUrl`). */
  url: string;
  /** Readiness budget (ms). Default 60s locally, 120s in CI. */
  timeoutMs?: number;
  /** Readiness poll interval (ms). Default 500. */
  pollMs?: number;
}

/** Default readiness probe: a HEAD request — any HTTP response (even 404) means the server is listening. */
const defaultProbe: DevServerReadyProbe = async (url) => {
  try {
    await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(DEFAULT_PROBE_TIMEOUT_MS) });
    return true;
  } catch {
    return false;
  }
};

/**
 * Kill the whole process tree. The child is spawned `detached` on POSIX so it leads its own process
 * group (pgid === pid); signalling `-pid` reaches the shell *and* its grandchildren. Windows has no
 * POSIX groups — `taskkill /T /F` walks the tree instead. Falls back to a direct child kill.
 */
const defaultKill: DevServerKill = (proc, signal) => {
  const pid = proc.pid;
  if (pid === undefined) {
    proc.kill(signal);
    return;
  }
  if (isWindows) {
    nodeSpawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' }).on('error', () => {});
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    // Group already gone, or the child never became a group leader — signal it directly.
    proc.kill(signal);
  }
};

export class DevServerProcess {
  #proc?: ChildProcess;
  // A spawn 'error' (e.g. ENOENT) leaves exitCode/signalCode null, so the readiness loop would spin
  // to the full timeout. Capture it to fail fast.
  #spawnError?: Error;
  // Last few stderr lines so a startup failure (port in use, bad config) surfaces its real cause in
  // the thrown error rather than only at debug level.
  #stderrTail: string[] = [];
  readonly #spawn: typeof nodeSpawn;
  readonly #probe: DevServerReadyProbe;
  readonly #kill: DevServerKill;

  constructor(deps: { spawn?: typeof nodeSpawn; probe?: DevServerReadyProbe; kill?: DevServerKill } = {}) {
    this.#spawn = deps.spawn ?? nodeSpawn;
    this.#probe = deps.probe ?? defaultProbe;
    this.#kill = deps.kill ?? defaultKill;
  }

  isRunning(): boolean {
    // A failed spawn fires 'error' but leaves exitCode/signalCode/killed in their "never started"
    // state, so guard on #spawnError first.
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

  async start(options: DevServerStartOptions): Promise<void> {
    const cwd = options.cwd ?? process.cwd();
    this.#spawnError = undefined;
    this.#stderrTail = [];

    log.info(`Starting dev server: ${options.command} (cwd: ${cwd})`);
    const proc = this.#spawn(options.command, {
      cwd,
      shell: true,
      // Own process group so teardown can kill the tree (see defaultKill).
      detached: !isWindows,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...options.env },
    });
    this.#proc = proc;
    proc.stdout?.on('data', (d: Buffer) => log.debug(`[dev-server] ${d.toString().trim()}`));
    proc.stderr?.on('data', (d: Buffer) => {
      const line = d.toString().trim();
      log.debug(`[dev-server] ${line}`);
      if (line) {
        this.#stderrTail.push(line);
        if (this.#stderrTail.length > 20) {
          this.#stderrTail.shift();
        }
      }
    });
    proc.on('error', (e) => {
      this.#spawnError = e;
      log.error(`Dev server spawn error: ${e.message}`);
    });

    await this.#waitForReady(options);
  }

  async #waitForReady(options: DevServerStartOptions): Promise<void> {
    const timeout = options.timeoutMs ?? (process.env.CI ? CI_READY_TIMEOUT_MS : DEFAULT_READY_TIMEOUT_MS);
    const interval = options.pollMs ?? DEFAULT_POLL_MS;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (this.#spawnError) {
        throw new Error(`Dev server failed to start: ${this.#spawnError.message}`);
      }
      const p = this.#proc;
      if (p && (p.exitCode !== null || p.signalCode !== null)) {
        throw new Error(this.#withStderr('Dev server process exited during startup'));
      }
      if (await this.#probe(options.url)) {
        // A spawn 'error' may have fired during the probe await; assert to defeat the stale
        // control-flow narrowing from the loop-top guard.
        const spawnError = this.#spawnError as Error | undefined;
        if (spawnError) {
          throw new Error(`Dev server failed to start: ${spawnError.message}`);
        }
        // Likewise, the owned process may have exited during the probe await while a pre-existing
        // server answered the URL — a fresh read of #proc reflects its current exit state.
        const proc = this.#proc;
        if (proc && (proc.exitCode !== null || proc.signalCode !== null)) {
          throw new Error(this.#withStderr('Dev server process exited during startup'));
        }
        log.info(`Dev server ready at ${options.url}`);
        return;
      }
      await delay(interval);
    }
    throw new Error(this.#withStderr(`Dev server did not become ready within ${timeout}ms at ${options.url}`));
  }

  /** Append the buffered stderr tail to a startup-failure message so the cause is visible. */
  #withStderr(message: string): string {
    return this.#stderrTail.length > 0 ? `${message}\nDev server stderr:\n${this.#stderrTail.join('\n')}` : message;
  }

  async stop(): Promise<void> {
    const proc = this.#proc;
    if (!proc || proc.killed) {
      return;
    }
    if (this.#spawnError) {
      // Spawn failed: Node fired 'error' but never will fire 'exit' — no live process to kill.
      this.#proc = undefined;
      return;
    }
    if (proc.exitCode !== null || proc.signalCode !== null) {
      this.#proc = undefined;
      return;
    }
    log.debug('Stopping dev server...');
    this.#kill(proc, 'SIGTERM');
    await this.#waitForExit(proc);
    this.#proc = undefined;
  }

  #waitForExit(proc: ChildProcess): Promise<void> {
    const stopTimeout = process.env.CI ? 10_000 : 5_000;
    return new Promise<void>((resolve) => {
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const graceTimer = setTimeout(() => {
        log.warn(`Dev server did not stop gracefully after ${stopTimeout}ms, forcing kill`);
        this.#kill(proc, 'SIGKILL');
        killTimer = setTimeout(resolve, 5_000);
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
