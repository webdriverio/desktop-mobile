// Spawn + manage `WebKitWebDriver` for the Linux WebKitGTK (W3C WebDriver) transport.
//
// Unlike the CDP-attach path (macOS CEF / Windows WebView2), where the service spawns the app
// and a Chromedriver attaches, WebKitGTK inverts this: `WebKitWebDriver` is the W3C server, and
// it LAUNCHES the app (via `webkitgtk:browserOptions.binary` + `--automation`) when the worker
// creates a session. So the launcher spawns this driver per worker and points WDIO's connection
// at it (hostname/port); the driver owns the app process. No Rust intermediary is needed —
// electrobun 2.0.1 exposes WebKitGTK automation upstream (#467), so the app is driven the same
// way `WebKitWebDriver` drives MiniBrowser.

import { type ChildProcess, execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

import { createLogger } from '@wdio/native-utils';

import { SERVICE_NAME } from './constants.js';

const log = createLogger(SERVICE_NAME, 'driver');

/** A spawned `WebKitWebDriver` process bound to a host:port. */
export interface WebKitDriverProcess {
  process: ChildProcess;
  host: string;
  port: number;
}

// Common install locations, tried after `which`. The `webkit2gtk-driver` package installs
// `/usr/bin/WebKitWebDriver`; the versioned libdir paths cover distros that don't symlink it.
const COMMON_DRIVER_PATHS = [
  '/usr/bin/WebKitWebDriver',
  '/usr/local/bin/WebKitWebDriver',
  '/usr/lib/webkit2gtk-4.1/WebKitWebDriver',
  '/usr/lib/webkit2gtk-4.0/WebKitWebDriver',
];

/**
 * Locate the `WebKitWebDriver` binary on Linux (PATH first, then common install paths), or
 * `undefined` if not found / not on Linux. The launcher turns `undefined` into an actionable
 * install error (`webKitWebDriverNotFound`).
 */
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

/**
 * Build the `WebKitWebDriver` CLI args. IMPORTANT: the flags are equals-form — `--port=N`,
 * `--host=H`. Space-form (`--port N`) makes WebKitWebDriver print usage and exit 1.
 */
export function webKitWebDriverArgs(host: string, port: number): string[] {
  return [`--host=${host}`, `--port=${port}`];
}

/** How long to wait after SIGTERM before escalating to SIGKILL (longer on CI). */
const KILL_TIMEOUT_MS = process.env.CI ? 10_000 : 5_000;

/**
 * Poll `WebKitWebDriver`'s `/status` until it reports ready, or throw on timeout. `fetchImpl`
 * is injectable for tests.
 */
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
        // WebKitWebDriver reports `{ value: { ready, message } }`; treat a 200 with a value as
        // usable even if `ready` is momentarily false — New Session then blocks until ready.
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

/**
 * Spawn `WebKitWebDriver` on `port` and wait until it is ready to accept sessions. The app is
 * NOT launched here — the driver launches it when the worker opens its session.
 */
export async function spawnWebKitWebDriver(opts: {
  driverPath: string;
  port: number;
  host?: string;
  readyTimeoutMs?: number;
}): Promise<WebKitDriverProcess> {
  const host = opts.host ?? '127.0.0.1';
  log.debug(`Spawning WebKitWebDriver: ${opts.driverPath} ${webKitWebDriverArgs(host, opts.port).join(' ')}`);
  const child = spawn(opts.driverPath, webKitWebDriverArgs(host, opts.port), {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk: Buffer) => log.debug(`[WebKitWebDriver] ${chunk.toString().trimEnd()}`));
  child.stderr?.on('data', (chunk: Buffer) => log.debug(`[WebKitWebDriver:err] ${chunk.toString().trimEnd()}`));
  child.on('exit', (code) => log.debug(`WebKitWebDriver exited with code ${code}`));

  const handle: WebKitDriverProcess = { process: child, host, port: opts.port };
  try {
    await waitForWebKitWebDriverReady(host, opts.port, opts.readyTimeoutMs);
  } catch (error) {
    await stopWebKitWebDriver(handle).catch(() => {});
    throw error;
  }
  return handle;
}

/**
 * Stop a `WebKitWebDriver` process: SIGTERM, then SIGKILL if it doesn't exit within the
 * timeout. Killing the driver also tears down the app it launched. WebKitWebDriver can be slow
 * to release a session on teardown, so the SIGKILL fallback matters.
 */
export async function stopWebKitWebDriver(handle: WebKitDriverProcess, killTimeoutMs = KILL_TIMEOUT_MS): Promise<void> {
  const { process: child } = handle;
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, killTimeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}
