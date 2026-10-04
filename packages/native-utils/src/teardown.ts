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

// Long enough for a SIGTERM grace + SIGKILL wait, which DEFAULT_TEARDOWN_TIMEOUT_MS would cut short.
export const PROCESS_TEARDOWN_TIMEOUT_MS = 30_000;

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

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  // Protocol/CDP layers often reject with a plain `{ message }` object.
  const message = (error as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' ? message : String(error);
}

export function isBenignTeardownError(error: unknown): boolean {
  const haystack = `${(error as { message?: string })?.message ?? error ?? ''} ${
    (error as { code?: string })?.code ?? ''
  }`.toLowerCase();
  return BENIGN_TEARDOWN_ERROR_PATTERNS.some((pattern) => haystack.includes(pattern));
}

/** Pass only teardowns whose failure leaks something; their failures are aggregated with the startup error. */
export async function failStartup(
  startupError: unknown,
  label: string,
  ...teardowns: Array<() => unknown>
): Promise<never> {
  // Ensure an Error is propagated, even for a bare reject() or a string.
  const error =
    startupError instanceof Error
      ? startupError
      : new Error(`${label} startup failed: ${errorMessage(startupError)}`, { cause: startupError });
  const failures: unknown[] = [];
  for (const teardown of teardowns) {
    try {
      await teardown();
    } catch (cleanupError) {
      failures.push(cleanupError);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError([error, ...failures], `${label} startup and cleanup failed`, { cause: error });
  }
  throw error;
}

/** On timeout, abandons the op and resolves undefined rather than rejecting. */
export async function runBounded<T>(
  op: () => Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void,
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Keep a rejection after the deadline from surfacing as an unhandledRejection.
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

/** Never throws: onComplete or process exit reaps anything a failed delete leaves behind. */
export async function safeDeleteSession(
  browser: WebdriverIO.Browser,
  context: string,
  log: Pick<Logger, 'debug' | 'warn'>,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  if (!browser.sessionId) {
    return;
  }
  log.debug(`Deleting session during ${context}: ${browser.sessionId}`);
  try {
    await runBounded(
      () => browser.deleteSession(),
      options.timeoutMs ?? PROCESS_TEARDOWN_TIMEOUT_MS,
      () => log.warn(`deleteSession timed out during ${context}`),
    );
  } catch (e) {
    if (isBenignTeardownError(e)) {
      log.debug(`Ignoring benign teardown error during deleteSession (${context}): ${errorMessage(e)}`);
      return;
    }
    log.warn(`Failed to delete session during ${context}: ${errorMessage(e)}`);
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
  const timeoutMs = options.timeoutMs ?? PROCESS_TEARDOWN_TIMEOUT_MS;
  let timedOut = false;
  try {
    await runBounded(
      async () => {
        try {
          return await launcher.onComplete?.();
        } catch (e) {
          if (timedOut) {
            log.warn(`launcher.onComplete() failed after timing out during ${context}: ${errorMessage(e)}`);
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
    log.warn(`launcher.onComplete() failed during ${context}: ${errorMessage(e)}`);
    return;
  }
  // A timeout counts as a failure: a hung onComplete is the likeliest leak.
  if (timedOut && options.rethrow) {
    throw new Error(`launcher.onComplete() timed out after ${timeoutMs}ms during ${context}`);
  }
}
