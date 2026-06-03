// Native-mode process management for the Electrobun launcher.
//
// Electrobun is CDP-attach: the launcher spawns the built app binary, CEF binds
// the port pinned in build.json, and the worker's CdpBridge attaches over CDP.
// This module owns the per-worker bundle clone, the spawn + backend log capture,
// and the teardown that kills the process and removes the clone.
//
// Each worker gets a private bundle clone because CEF reads chromiumFlags
// (remote-debugging-port) ONLY from the bundle's build.json, not a launch arg — so a
// worker needs its own bundle copy to pin its own port. We clone here and write the
// port into the clone, never mutating the user's shared bundle. We deliberately do
// NOT pin a separate --user-data-dir (see spawnElectrobunApp): CEF's own
// root_cache_path is the user-data-dir, which keeps the forced persist:default
// partition profile creatable. That makes instances share root_cache_path, so this is
// single-instance only (maxInstances=1); multiremote stays blocked pending an upstream
// CEF fix (see the agent-os plan "Framework gaps").
//
// E2E-validation gap: clone/spawn/teardown can only be exercised against a real
// built CEF bundle (none in unit tests). Unit tests mock node:child_process /
// node:fs at the @wdio/native-core + node boundary; the live path is E2E-only.

import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { Interface as ReadlineInterface } from 'node:readline';

import { createLogCapture } from '@wdio/native-core';
import { createLogger } from '@wdio/native-utils';

import { SERVICE_NAME } from './constants.js';
import { type ResolvedElectrobunApp, writeRemoteDebuggingPort } from './electrobunConfig.js';
import { SevereServiceError } from './errors.js';
import type { ElectrobunServiceOptions } from './types.js';

const log = createLogger(SERVICE_NAME, 'launcher');

const SIGKILL_GRACE_MS = 5_000;

export interface ElectrobunAppProcess {
  proc: ChildProcess;
  /** Temp dirs to remove on teardown (the bundle-clone parent). */
  cleanupDirs: string[];
  /** Allocated CEF remote-debugging port (pinned into the cloned bundle's build.json). */
  port: number;
  logHandlers: ReadlineInterface[];
}

export interface SpawnElectrobunAppParams {
  app: ResolvedElectrobunApp;
  appArgs: string[];
  port: number;
  options: ElectrobunServiceOptions;
  instanceId?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Clone an app bundle into a fresh temp parent so each worker can pin its own CEF
 * remote-debugging port without mutating the user's shared bundle.
 *
 * On macOS this uses `cp -Rc` (APFS clonefile) so the ~125MB CEF framework is
 * copy-on-write rather than duplicated — near-instant. On a non-APFS volume `cp
 * -Rc` fails; we fall back to a recursive `cpSync`. Non-darwin platforms always
 * take the `cpSync` path.
 */
export function cloneAppBundle(bundlePath: string): { cloneParentDir: string; clonedBundlePath: string } {
  const cloneParentDir = mkdtempSync(join(tmpdir(), 'wdio-electrobun-bundle-'));
  const clonedBundlePath = join(cloneParentDir, basename(bundlePath));

  try {
    if (process.platform === 'darwin') {
      try {
        execFileSync('cp', ['-Rc', bundlePath, clonedBundlePath]);
        return { cloneParentDir, clonedBundlePath };
      } catch (error) {
        // Non-APFS volume (clonefile unsupported) — fall back to a full recursive copy.
        log.debug(`APFS clone failed for ${bundlePath}, falling back to recursive copy: ${(error as Error).message}`);
        // `cp -Rc` may have written a partial tree before failing; clear it so the cpSync
        // fallback starts clean rather than merging onto a half-copied bundle.
        rmSync(clonedBundlePath, { recursive: true, force: true });
      }
    }

    cpSync(bundlePath, clonedBundlePath, { recursive: true });
    return { cloneParentDir, clonedBundlePath };
  } catch (error) {
    // The copy failed (e.g. cpSync threw) — remove the empty temp parent mkdtempSync
    // created so it doesn't leak, then rethrow.
    rmSync(cloneParentDir, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Spawn a built Electrobun app for native-mode CDP attach.
 *
 * Clones the resolved bundle into a per-worker temp dir and pins ONLY `port` into the
 * clone's build.json (CEF reads chromiumFlags there, not argv) — deliberately NOT a
 * `--user-data-dir`, so CEF's own root_cache_path stays the user-data-dir and the forced
 * persist:default profile creates cleanly (see the inline note below; this is what makes
 * the service single-instance / `maxInstances=1`). Spawns the CLONED binary, and (when log
 * capture is enabled) wires stdout/stderr through `createLogCapture`. Returns the process
 * handle plus the temp dirs so the launcher can tear them all down.
 */
export function spawnElectrobunApp(params: SpawnElectrobunAppParams): ElectrobunAppProcess {
  const { app, appArgs, port, options, instanceId } = params;

  if (!app.buildJsonPath) {
    throw new SevereServiceError(
      `Cannot pin the CEF remote-debugging port: the resolved Electrobun app has no build.json path ` +
        `(bundle: ${app.bundlePath}). The port is read from build.json, not a launch arg, so a worker ` +
        'cannot get an isolated port without one.',
    );
  }

  const { cloneParentDir, clonedBundlePath } = cloneAppBundle(app.bundlePath);
  // Rebase the binary + build.json onto the clone by swapping the bundle prefix.
  const clonedBinaryPath = app.binaryPath.replace(app.bundlePath, clonedBundlePath);
  const clonedBuildJsonPath = app.buildJsonPath.replace(app.bundlePath, clonedBundlePath);

  // The clone isn't tracked for teardown until we return the handle, so remove it
  // here if pinning the port throws (it's the large, CEF-bearing temp dir).
  //
  // Pin ONLY the port — do NOT inject a separate --user-data-dir. CEF then uses its
  // own root_cache_path (~/Library/Application Support | ~/.cache | %LOCALAPPDATA%
  // per OS) as the Chrome user-data-dir, so the persist:default partition profile
  // (at <root_cache_path>/partitions/default, forced by BrowserWindow) lands INSIDE
  // the user-data-dir and creates cleanly. A /tmp --user-data-dir left that partition
  // OUTSIDE the profile dir → "Cannot create profile" → a racy global-context fallback
  // that was the cross-OS e2e blocker (recoverable on macOS, fatal on Linux/Windows).
  // Trade-off: instances now share root_cache_path, so this is single-instance only
  // (maxInstances=1) — multiremote stays blocked pending an upstream CEF fix.
  try {
    writeRemoteDebuggingPort(clonedBuildJsonPath, port);
  } catch (error) {
    rmSync(cloneParentDir, { recursive: true, force: true });
    throw error;
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env,
  };

  // Linux CI runners are headless and CEF is a GUI process that needs an X display
  // ("Failed to open X11 display" otherwise → no browser → no /json). WDIO's autoXvfb
  // covers the worker process, not this launcher-spawned app, so run the app under
  // `xvfb-run -a` (a throwaway X server) on Linux. macOS/Windows runners have a real
  // display, so spawn the binary directly there. Unreachable in 0.x (the launcher's
  // macOS guard throws first) — kept for the Linux re-fold (#320).
  const useXvfb = process.platform === 'linux';
  const command = useXvfb ? 'xvfb-run' : clonedBinaryPath;
  const spawnArgs = useXvfb ? ['-a', clonedBinaryPath, ...appArgs] : appArgs;

  log.info(`Spawning Electrobun app: ${clonedBinaryPath} ${appArgs.join(' ')} (CDP port ${port})`);
  const proc = spawn(command, spawnArgs, {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
  log.info(`Electrobun app spawned (PID: ${proc.pid})`);

  const logHandlers: ReadlineInterface[] = [];
  if (options.captureBackendLogs) {
    const identifier = `electrobun-${port}`;
    const onLine = (line: string): void => {
      log.info(`[backend] ${line}`);
    };
    const stdoutHandler = createLogCapture({ stream: proc.stdout, identifier, instanceId, onLine });
    if (stdoutHandler) {
      logHandlers.push(stdoutHandler);
    }
    const stderrHandler = createLogCapture({ stream: proc.stderr, identifier, instanceId, onLine });
    if (stderrHandler) {
      logHandlers.push(stderrHandler);
    }
  }

  // A post-spawn 'error' (e.g. ENOENT for a bad binary path) would otherwise be
  // an uncaught exception. Surface it; the worker's CDP attach failing is the
  // real signal that the app didn't come up.
  proc.on('error', (err) => {
    log.error(`Electrobun app process error: ${err.message}`);
  });

  return { proc, cleanupDirs: [cloneParentDir], port, logHandlers };
}

const CDP_READY_TIMEOUT_MS = 30_000;
const CDP_READY_POLL_MS = 250;

/**
 * Wait until CEF is serving its CDP `/json` endpoint with at least one `page` target.
 *
 * The launcher spawns the app and sets `goog:chromeOptions.debuggerAddress`, but the
 * worker's Chromedriver attaches to that port independently. If it connects before CEF
 * has bound the port and registered a page (slow on Windows CI), session creation
 * times out ("cannot connect to chrome at localhost:N") and WDIO burns its full
 * connectionRetryTimeout per attempt. Polling `/json` here makes the attach reliable.
 *
 * Resolves (with a warning) on timeout rather than throwing: a failed attach is the
 * real signal, and a hard throw would mask it as a launcher error.
 */
export async function waitForCdpReady(port: number, timeoutMs: number = CDP_READY_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // 127.0.0.1, not 'localhost': CEF binds the debugger on IPv4, but Node resolves
  // 'localhost' to IPv6 ::1 first on Windows/Linux CI, so the fetch would always fail.
  const url = `http://127.0.0.1:${port}/json`;
  let lastError = 'no response';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) {
        const targets = (await res.json()) as Array<{ type?: string }>;
        if (Array.isArray(targets) && targets.some((target) => target?.type === 'page')) {
          return;
        }
        lastError = 'no page target yet';
      }
    } catch (error) {
      lastError = (error as Error).message;
    }
    await sleep(CDP_READY_POLL_MS);
  }
  log.warn(
    `CEF CDP endpoint 127.0.0.1:${port} not ready after ${timeoutMs}ms (${lastError}); ` +
      "proceeding — the worker's session attach may fail",
  );
}

/**
 * Stop a spawned Electrobun app: close log handlers, SIGTERM (SIGKILL after a
 * grace period), then remove its temp dirs (the bundle-clone parent). Tolerant of an
 * already-dead process and missing temp dirs.
 */
export async function stopElectrobunApp(app: ElectrobunAppProcess): Promise<void> {
  for (const handler of app.logHandlers) {
    try {
      handler.close();
    } catch {
      // ignore
    }
  }

  const { proc } = app;
  if (proc.pid && proc.exitCode === null && proc.signalCode === null) {
    log.info(`Stopping Electrobun app (PID: ${proc.pid})…`);
    proc.kill('SIGTERM');

    const deadline = Date.now() + SIGKILL_GRACE_MS;
    while (Date.now() < deadline) {
      if (proc.exitCode !== null || proc.signalCode !== null) {
        break;
      }
      await sleep(100);
    }
    if (proc.exitCode === null && proc.signalCode === null) {
      log.warn('Electrobun app did not exit gracefully, sending SIGKILL');
      proc.kill('SIGKILL');
    }
  }

  for (const dir of app.cleanupDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      log.warn(`Failed to remove Electrobun temp dir ${dir}: ${(error as Error).message}`);
    }
  }
}
