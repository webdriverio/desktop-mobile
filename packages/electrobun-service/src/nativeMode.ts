// Native-mode process management for the Electrobun launcher.
//
// Electrobun is CDP-attach: the launcher spawns the built app binary, CEF binds
// the port pinned in build.json, and the worker's CdpBridge attaches over CDP.
// This module owns the spawn + per-run CFFIXED_USER_HOME temp dir + backend log
// capture, and the teardown that kills the process and removes the temp dir.
//
// MVP is single-instance. A per-run CFFIXED_USER_HOME gives each run a clean,
// isolated CEF cache root (RESEARCH_FINDINGS: NSApplicationSupportDirectory
// honours CFFIXED_USER_HOME, defeating CEF's single-instance-per-cache-root
// folding). PR3 will clone the bundle per worker for true multi-worker
// parallelism; this module is the N=1 path of that mechanism.
//
// E2E-validation gap: spawn/teardown can only be exercised against a real built
// CEF bundle (none in unit tests). Unit tests mock node:child_process / node:fs
// at the @wdio/native-core + node boundary; the live path is covered by E2E.

import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Interface as ReadlineInterface } from 'node:readline';

import { createLogCapture } from '@wdio/native-core';
import { createLogger } from '@wdio/native-utils';

import { SERVICE_NAME } from './constants.js';
import type { ElectrobunServiceOptions } from './types.js';

const log = createLogger(SERVICE_NAME, 'launcher');

const SIGKILL_GRACE_MS = 5_000;

export interface ElectrobunAppProcess {
  proc: ChildProcess;
  /** Per-run CFFIXED_USER_HOME temp dir to remove on teardown. */
  userHomeDir: string;
  /** Allocated CEF remote-debugging port (pinned into the bundle's build.json). */
  port: number;
  logHandlers: ReadlineInterface[];
}

export interface SpawnElectrobunAppParams {
  binaryPath: string;
  appArgs: string[];
  port: number;
  options: ElectrobunServiceOptions;
  instanceId?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Spawn a built Electrobun app for native-mode CDP attach.
 *
 * Creates a per-run `CFFIXED_USER_HOME` temp dir for an isolated CEF cache root,
 * spawns the binary, and (when log capture is enabled) wires stdout/stderr
 * through `createLogCapture`. Returns the process handle plus the temp dir so the
 * launcher can tear both down.
 *
 * The caller MUST have already pinned `port` into the bundle's build.json — the
 * port is fixed per bundle, not a launch arg.
 */
export function spawnElectrobunApp(params: SpawnElectrobunAppParams): ElectrobunAppProcess {
  const { binaryPath, appArgs, port, options, instanceId } = params;

  const userHomeDir = mkdtempSync(join(tmpdir(), 'wdio-electrobun-home-'));

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...options.env,
    // Redirect CEF's cache root to a per-run dir so a stale cache can't fold this
    // launch into an existing browser session (RESEARCH_FINDINGS §CFFIXED_USER_HOME).
    CFFIXED_USER_HOME: userHomeDir,
  };

  log.info(`Spawning Electrobun app: ${binaryPath} ${appArgs.join(' ')} (CDP port ${port})`);
  const proc = spawn(binaryPath, appArgs, {
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

  return { proc, userHomeDir, port, logHandlers };
}

/**
 * Stop a spawned Electrobun app: close log handlers, SIGTERM (SIGKILL after a
 * grace period), then remove the per-run CFFIXED_USER_HOME temp dir. Tolerant of
 * an already-dead process and a missing temp dir.
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

  try {
    rmSync(app.userHomeDir, { recursive: true, force: true });
  } catch (error) {
    log.warn(`Failed to remove CFFIXED_USER_HOME temp dir ${app.userHomeDir}: ${(error as Error).message}`);
  }
}
