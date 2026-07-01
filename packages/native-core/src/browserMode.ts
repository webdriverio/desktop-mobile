import type { DevServer } from '@wdio/native-types';
import { createLogger, Err, isErr, isOk, Ok, type Result } from '@wdio/native-utils';
import { DevServerProcess, type DevServerReadyProbe } from './devServerProcess.js';

const log = createLogger('native-core', 'launcher');

// Browser mode drives the app's web UI through a real Chrome session (WDIO enables
// BiDi by default for browserName: 'chrome'). Any other browserName is a
// misconfiguration the launcher must reject rather than silently overwrite.
export const BROWSER_MODE_SUPPORTED_BROWSER = 'chrome';

const DEV_SERVER_PROBE_TIMEOUT_MS = 3000;

/**
 * Validate a user-supplied `browserName` for browser mode.
 *
 * Returns an actionable error message when `browserName` is set to a value the
 * service can't drive in browser mode; returns `undefined` when the value is
 * acceptable (unset, or one of `allowed`). Each launcher throws its own
 * `SevereServiceError` with this message so the runner stops with a clear
 * explanation instead of silently rewriting the capability.
 *
 * `allowed` defaults to `['chrome']`. Electron passes its native detection
 * value too (`['chrome', 'electron']`), since the launcher rewrites a
 * legitimate `browserName: 'electron'` to chrome for the browser-mode session.
 */
export function nonChromeBrowserNameError(
  browserName: unknown,
  allowed: readonly string[] = [BROWSER_MODE_SUPPORTED_BROWSER],
): string | undefined {
  if (typeof browserName !== 'string' || allowed.includes(browserName.toLowerCase())) {
    return undefined;
  }
  // `allowed` also carries each service's native detection name (e.g. 'electron', 'wry') so a
  // carried-over native cap isn't rejected — but those aren't something to advise setting, so the
  // message guides the user to 'chrome' (or removal), not the full allow-list.
  return (
    `Browser mode only supports browserName: '${BROWSER_MODE_SUPPORTED_BROWSER}', but got '${browserName}'. ` +
    `Remove the browserName from your capability (it is set automatically) or set it to '${BROWSER_MODE_SUPPORTED_BROWSER}'.`
  );
}

/**
 * Preflight the dev server before the worker navigates to it.
 *
 * A HEAD request with a short timeout. Any non-network response (even 404/405)
 * proves the server is listening, so only a thrown fetch error (connection
 * refused, DNS failure, timeout) counts as unreachable. Runs in the launcher's
 * main process where outbound network is available.
 */
export async function probeDevServerReachable(
  url: string,
  timeoutMs: number = DEV_SERVER_PROBE_TIMEOUT_MS,
): Promise<Result<void, Error>> {
  try {
    await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(timeoutMs) });
    return Ok(undefined);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return Err(new Error(`Dev server not reachable at ${url} — is it running? (${detail})`));
  }
}

const DEV_SERVER_READY_TIMEOUT_MS = 60_000;
const DEV_SERVER_READY_POLL_MS = 500;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Poll {@link probeDevServerReachable} until the server answers or the budget elapses.
 *
 * The single-shot `probeDevServerReachable` is a preflight for a server the user already started;
 * this is the "wait for a server we (or the user's function) just started to come up" variant.
 */
export async function waitForDevServerReachable(
  url: string,
  {
    timeoutMs = DEV_SERVER_READY_TIMEOUT_MS,
    pollMs = DEV_SERVER_READY_POLL_MS,
  }: { timeoutMs?: number; pollMs?: number } = {},
): Promise<Result<void, Error>> {
  const start = Date.now();
  let last = await probeDevServerReachable(url);
  while (isErr(last) && Date.now() - start < timeoutMs) {
    await delay(pollMs);
    last = await probeDevServerReachable(url);
  }
  return last;
}

/**
 * Start (or reuse) a dev server for browser mode and return a handle to tear it down.
 *
 * Handles all three {@link DevServer} forms so each launcher stays a few lines:
 * - **function** — call it, poll its returned `url` for readiness, and teardown is its `close()`
 *   (no subprocess spawn/kill involved). The returned `url` supplies/overrides `devServerUrl`.
 * - **string / object** — if `reuseExistingServer` (default `!CI`) and `devServerUrl` is already
 *   reachable, skip the spawn; otherwise spawn a {@link DevServerProcess} and poll `devServerUrl`.
 *
 * The caller stores the returned `stop` and must call it in `onComplete` *and* on an `onPrepare`
 * failure (WDIO does not call `onComplete` after `onPrepare` throws). `stop` is idempotent.
 */
export async function startManagedDevServer(
  devServer: DevServer,
  devServerUrl: string,
  deps: {
    spawn?: typeof import('node:child_process').spawn;
    probe?: DevServerReadyProbe;
    isCI?: boolean;
    readinessTimeoutMs?: number;
    readinessPollMs?: number;
  } = {},
): Promise<{ url: string; stop: () => Promise<void> }> {
  if (typeof devServer === 'function') {
    const { url, close } = await devServer();
    const ready = await waitForDevServerReachable(url, {
      timeoutMs: deps.readinessTimeoutMs,
      pollMs: deps.readinessPollMs,
    });
    if (isErr(ready)) {
      await close();
      throw ready.error;
    }
    return { url, stop: close };
  }

  const config = typeof devServer === 'string' ? { command: devServer } : devServer;
  const isCI = deps.isCI ?? Boolean(process.env.CI);
  const reuseExisting = config.reuseExistingServer ?? !isCI;
  if (reuseExisting && isOk(await probeDevServerReachable(devServerUrl))) {
    log.info(`Reusing dev server already reachable at ${devServerUrl}`);
    return { url: devServerUrl, stop: async () => {} };
  }

  const proc = new DevServerProcess({ spawn: deps.spawn, probe: deps.probe });
  await proc.start({
    command: config.command,
    cwd: config.cwd,
    env: config.env,
    url: devServerUrl,
    timeoutMs: config.timeoutMs,
  });
  return { url: devServerUrl, stop: () => proc.stop() };
}
