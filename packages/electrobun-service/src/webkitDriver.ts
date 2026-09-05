// Spawn + manage `WebKitWebDriver` for the Linux WebKitGTK (W3C WebDriver) transport.
//
// Unlike the CDP-attach path (macOS CEF / Windows WebView2), where the service spawns the app and a
// Chromedriver attaches, `WebKitWebDriver` is itself the W3C server and it LAUNCHES the app.

import { type ChildProcess, execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

import { createLogger } from '@wdio/native-utils';

import { SERVICE_NAME } from './constants.js';

const log = createLogger(SERVICE_NAME, 'driver');

export interface WebKitDriverProcess {
  process: ChildProcess;
  host: string;
  port: number;
  /** Spawned detached (its own process group) so teardown can kill the whole xvfb-run tree. */
  detached: boolean;
}

// The `webkit2gtk-driver` package installs `/usr/bin/WebKitWebDriver`; the versioned libdir
// paths cover distros that don't symlink it.
const COMMON_DRIVER_PATHS = [
  '/usr/bin/WebKitWebDriver',
  '/usr/local/bin/WebKitWebDriver',
  '/usr/lib/webkit2gtk-4.1/WebKitWebDriver',
  '/usr/lib/webkit2gtk-4.0/WebKitWebDriver',
];

export function getWebKitWebDriverPath(platform: NodeJS.Platform = process.platform): string | undefined {
  if (platform !== 'linux') {
    return undefined;
  }
  try {
    const found = execSync('which WebKitWebDriver', { encoding: 'utf8' }).trim();
    if (found && existsSync(found)) {
      log.debug(`Found WebKitWebDriver at: ${found}`);
      return found;
    }
  } catch {
    log.debug('WebKitWebDriver not found in PATH');
  }
  for (const candidate of COMMON_DRIVER_PATHS) {
    if (existsSync(candidate)) {
      log.debug(`Found WebKitWebDriver at: ${candidate}`);
      return candidate;
    }
  }
  return undefined;
}

/** IMPORTANT: equals-form flags. Space-form (`--port N`) makes WebKitWebDriver print usage and exit 1. */
export function webKitWebDriverArgs(host: string, port: number): string[] {
  return [`--host=${host}`, `--port=${port}`];
}

const KILL_TIMEOUT_MS = process.env.CI ? 10_000 : 5_000;

export async function waitForWebKitWebDriverReady(
  host: string,
  port: number,
  timeoutMs = 15_000,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetchImpl(`http://${host}:${port}/status`);
      if (res.ok) {
        const body = (await res.json()) as { value?: { ready?: boolean } };
        // A 200 with a `value` is enough; New Session blocks until ready, so a transient `ready: false` is fine.
        if (body?.value) {
          return;
        }
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `WebKitWebDriver did not become ready on ${host}:${port} within ${timeoutMs}ms` +
      (lastError ? `: ${(lastError as Error).message}` : ''),
  );
}

export async function spawnWebKitWebDriver(opts: {
  driverPath: string;
  port: number;
  host?: string;
  readyTimeoutMs?: number;
}): Promise<WebKitDriverProcess> {
  const host = opts.host ?? '127.0.0.1';
  const driverArgs = webKitWebDriverArgs(host, opts.port);

  // Linux CI runners are headless and WebKitWebDriver launches a GTK app that needs an X display.
  // WDIO's autoXvfb wraps the worker process, NOT this launcher-spawned driver, so run it under
  // `xvfb-run -a` — mirroring the CEF app spawn in nativeMode.ts.
  const useXvfb = process.platform === 'linux';
  const command = useXvfb ? 'xvfb-run' : opts.driverPath;
  const spawnArgs = useXvfb ? ['-a', opts.driverPath, ...driverArgs] : driverArgs;

  log.debug(`Spawning WebKitWebDriver: ${command} ${spawnArgs.join(' ')}`);
  // Detach on Linux so xvfb-run becomes its own process-group leader: `xvfb-run` does NOT forward
  // signals to WebKitWebDriver (its child) or the app (WebKitWebDriver's child), so killing just
  // the xvfb-run pid orphans them — across retries the orphaned apps + X servers pile up and
  // starve the runner. Detaching lets teardown kill the whole group.
  const child = spawn(command, spawnArgs, { stdio: ['ignore', 'pipe', 'pipe'], detached: useXvfb });
  child.stdout?.on('data', (chunk: Buffer) => log.debug(`[WebKitWebDriver] ${chunk.toString().trimEnd()}`));
  child.stderr?.on('data', (chunk: Buffer) => log.debug(`[WebKitWebDriver:err] ${chunk.toString().trimEnd()}`));
  child.on('exit', (code) => log.debug(`WebKitWebDriver exited with code ${code}`));
  // Without this handler an 'error' event (e.g. spawn ENOENT) crashes the launcher as an uncaught exception.
  child.on('error', (error) => log.warn(`WebKitWebDriver process error: ${(error as Error).message}`));

  const handle: WebKitDriverProcess = { process: child, host, port: opts.port, detached: useXvfb };
  // If the spawn errors, reject immediately instead of waiting out the full readiness timeout.
  const spawnFailed = new Promise<never>((_, reject) => {
    child.once('error', (error: Error) =>
      reject(new Error(`Failed to spawn WebKitWebDriver (${command}): ${error.message}`)),
    );
  });
  spawnFailed.catch(() => {}); // avoids an unhandled rejection if 'error' fires after readiness
  try {
    await Promise.race([waitForWebKitWebDriverReady(host, opts.port, opts.readyTimeoutMs), spawnFailed]);
  } catch (error) {
    await stopWebKitWebDriver(handle).catch(() => {});
    throw error;
  }
  return handle;
}

/** SIGTERM, then SIGKILL to force exit when WebKitWebDriver is slow to release the session. */
export async function stopWebKitWebDriver(handle: WebKitDriverProcess, killTimeoutMs = KILL_TIMEOUT_MS): Promise<void> {
  const { process: child, detached } = handle;
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  // When detached, signal the process group with a negative pid, so xvfb-run + WebKitWebDriver +
  // the app all die — killing only the xvfb-run pid leaves the driver and app orphaned. Falls
  // back to the single child if the group is already gone or we didn't detach.
  const signalTree = (signal: NodeJS.Signals) => {
    try {
      if (detached && child.pid !== undefined) {
        process.kill(-child.pid, signal);
        return;
      }
    } catch {
      // the process group is already gone — fall through to the direct kill
    }
    child.kill(signal);
  };
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signalTree('SIGKILL');
      resolve();
    }, killTimeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    signalTree('SIGTERM');
  });
}
