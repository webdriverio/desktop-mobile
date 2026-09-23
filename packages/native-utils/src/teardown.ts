/**
 * During teardown the driver/debugger socket is frequently already gone, so a
 * session DELETE or CDP round-trip either rejects with a benign "already
 * closed / not found" error or stalls against a half-open socket. On Windows a
 * propagated or retried teardown error can crash the worker (libuv
 * `UV_HANDLE_CLOSING`, exit `0xC0000409`) or hang it until the CI step timeout,
 * in both cases after the test already passed.
 */

import type { Logger } from '@wdio/logger';

export const DEFAULT_TEARDOWN_TIMEOUT_MS = 10_000;

// For an onComplete that stops child processes in sequence: one stop alone can take the SIGTERM
// grace & SIGKILL wait, so the default deadline would abandon it mid-escalation.
export const PROCESS_TEARDOWN_TIMEOUT_MS = 30_000;

// Matching a superset across services is safe: every entry is benign once teardown has begun.
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
 * Pass only teardowns whose failure means a leak; delete the session before calling, since a delete
 * error here is a symptom of the startup failure. Teardowns are thunks so callers compose their own
 * steps without this helper needing service types.
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
 * On timeout the op is abandoned and this resolves `undefined` - it never rejects for a timeout.
 */
export async function runBounded<T>(
  op: () => Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void,
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // An abandoned op can still reject after the deadline; this stops that surfacing as an
    // unhandledRejection. The race still sees a rejection that lands before the timeout.
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
 * Never throws: a failed delete during teardown leaks nothing that onComplete or process exit won't reap.
 */
export async function safeDeleteSession(
  browser: WebdriverIO.Browser,
  context: string,
  log: Pick<Logger, 'debug' | 'warn'>,
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
    log.warn(`Failed to delete session during ${context}: ${(e as Error).message}`);
  }
}

/**
 * Bounded because onComplete can hang, e.g. on a user-supplied devServer close().
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
