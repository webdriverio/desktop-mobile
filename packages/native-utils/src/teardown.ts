/**
 * Helpers shared by the WDIO services for defensive session teardown.
 *
 * During teardown the driver/debugger socket is frequently already gone, so a
 * session DELETE or CDP round-trip either rejects with a benign "already
 * closed / not found" error or stalls against a half-open socket. On Windows a
 * propagated or retried teardown error can crash the worker (libuv
 * `UV_HANDLE_CLOSING`, exit `0xC0000409`) or hang it until the CI step timeout —
 * in both cases *after* the test already passed. These helpers let each service
 * swallow benign teardown errors and bound the operations.
 */

/**
 * Default teardown deadline (ms): how long a single teardown op may run before
 * it is abandoned. Shared so electron- and dioxus-service stay in sync.
 */
export const DEFAULT_TEARDOWN_TIMEOUT_MS = 10_000;

// Benign teardown failure modes across providers: WebDriver session lifecycle,
// CDP-bridge disconnects, and raw socket teardown. Matching a superset across
// services is safe — every entry is benign once teardown has begun.
export const BENIGN_TEARDOWN_ERROR_PATTERNS = [
  'session not found',
  'invalid session id',
  'session id is null',
  'websocket is not connected',
  'connection has been closed',
  'connection closed',
  'und_err_closed',
  'econnreset',
  'econnrefused',
  'socket hang up',
  'other side closed',
];

export function isBenignTeardownError(error: unknown): boolean {
  const haystack = `${(error as { message?: string })?.message ?? error ?? ''} ${
    (error as { code?: string })?.code ?? ''
  }`.toLowerCase();
  return BENIGN_TEARDOWN_ERROR_PATTERNS.some((pattern) => haystack.includes(pattern));
}

/**
 * Rethrow a standalone-startup failure after best-effort teardown: each teardown thunk runs in order,
 * and one that throws is collected rather than masking the startup error. Any teardown failure makes
 * the result an `AggregateError` (startup error as `cause`); otherwise the startup error is rethrown
 * unchanged.
 *
 * Teardowns are thunks so a caller composes its own non-uniform steps (e.g. tauri's
 * `onComplete(0, config, [])`) without this helper needing service types.
 */
export async function failStartup(
  startupError: unknown,
  label: string,
  ...teardowns: Array<() => unknown>
): Promise<never> {
  const failures: unknown[] = [];
  for (const teardown of teardowns) {
    try {
      await teardown();
    } catch (cleanupError) {
      failures.push(cleanupError);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError([startupError, ...failures], `${label} startup and cleanup failed`, {
      cause: startupError,
    });
  }
  throw startupError;
}

/**
 * Run a teardown operation bounded by a timeout so a stalled call can't block
 * the hook until the CI step timeout. On timeout the operation is abandoned
 * (the race settles to `undefined`) rather than rejected — teardown is
 * best-effort. `onTimeout` lets the caller log with its own service logger.
 */
export async function runBounded<T>(
  op: () => Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void,
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // If the timeout wins, the abandoned op may still reject later (e.g. the OS
    // resets the socket after the deadline). Attach a no-op rejection handler so
    // that late rejection can't surface as an unhandledRejection — the very
    // teardown crash this guard exists to prevent. The race still propagates a
    // rejection that arrives before the timeout.
    const opPromise = op();
    opPromise.catch(() => {});
    return await Promise.race([
      opPromise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => {
          onTimeout?.();
          resolve(undefined);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
