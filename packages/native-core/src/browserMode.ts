import { Err, Ok, type Result } from '@wdio/native-utils';

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
    return Err(new Error(`Dev server not reachable at ${url} — is it running? (${(error as Error).message})`));
  }
}
