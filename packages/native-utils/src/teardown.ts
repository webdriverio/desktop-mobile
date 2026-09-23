/**
 * Helpers shared by the WDIO services for defensive session teardown.
 *
 * During teardown the driver/debugger socket is frequently already gone, so a
 * session DELETE or CDP round-trip either rejects with a benign "already
 * closed / not found" error or stalls against a half-open socket. On Windows a
 * propagated or retried teardown error can crash the worker (libuv
 * `UV_HANDLE_CLOSING`, exit `0xC0000409`) or hang it until the CI step timeout,
 * in both cases after the test already passed.
 */

import type { Logger } from '@wdio/logger';

export const DEFAULT_TEARDOWN_TIMEOUT_MS = 10_000;

// For a launcher onComplete that stops child processes in sequence: each stop can take the
// SIGTERM grace plus the SIGKILL wait, so the default deadline would abandon a stop mid-escalation.
export const PROCESS_TEARDOWN_TIMEOUT_MS = 30_000;

// Benign teardown failure modes across providers. Matching a superset across
// services is safe: every entry is benign once teardown has begun.
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
 * Rethrow a standalone-startup failure after best-effort teardown: teardowns run in order, and any
 * that throw are collected into an `AggregateError` (startup error as `cause`) rather than masking it;
 * otherwise the startup error is rethrown unchanged.
 *
 * Teardowns are thunks so a caller composes its own non-uniform steps (e.g. electron also closing
 * its log writer) without this helper needing service types.
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
 * (the race settles to `undefined`) rather than rejected. `onTimeout` lets the
 * caller log with its own service logger.
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
    // that late rejection can't surface as an unhandledRejection. The race still
    // propagates a rejection that arrives before the timeout.
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

/**
 * Best-effort, time-bounded session deletion. A non-benign failure is swallowed (warned) unless
 * `rethrow` is set - for callers that must surface a broken delete.
 */
export async function safeDeleteSession(
  browser: WebdriverIO.Browser,
  context: string,
  log: Pick<Logger, 'debug' | 'warn'>,
  options: { rethrow?: boolean } = {},
): Promise<void> {
  if (!browser.sessionId) {
    return;
  }
  try {
    await runBounded(
      () => browser.deleteSession(),
      DEFAULT_TEARDOWN_TIMEOUT_MS,
      () => log.warn(`deleteSession timed out during ${context}`),
    );
  } catch (e) {
    if (isBenignTeardownError(e)) {
      log.debug(`Ignoring benign teardown error during deleteSession (${context}): ${(e as Error).message}`);
      return;
    }
    if (options.rethrow) {
      throw e;
    }
    log.warn(`Failed to delete session during ${context}: ${(e as Error).message}`);
  }
}

/**
 * Bound a launcher's onComplete teardown so a hung stop (a user-supplied devServer close(), a driver
 * or Metro shutdown) can't block teardown. A failure is warned and swallowed unless `rethrow` is set;
 * a launcher with no onComplete (e.g. Flutter) is a no-op. A failure that lands after the deadline is
 * still warned, since the caller has already moved on.
 */
export async function boundedOnComplete(
  launcher: { onComplete?(): Promise<void> },
  context: string,
  log: Pick<Logger, 'warn'>,
  options: { rethrow?: boolean; timeoutMs?: number } = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TEARDOWN_TIMEOUT_MS;
  let timedOut = false;
  try {
    await runBounded(
      async () => {
        try {
          return await launcher.onComplete?.();
        } catch (e) {
          if (timedOut) {
            log.warn(`launcher.onComplete() failed after timing out during ${context}: ${(e as Error).message}`);
          }
          throw e;
        }
      },
      timeoutMs,
      () => {
        timedOut = true;
        log.warn(`launcher.onComplete() timed out after ${timeoutMs}ms during ${context}`);
      },
    );
  } catch (e) {
    if (options.rethrow) {
      throw e;
    }
    log.warn(`launcher.onComplete() failed during ${context}: ${(e as Error).message}`);
  }
}
