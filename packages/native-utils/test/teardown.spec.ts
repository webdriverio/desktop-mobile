import { describe, expect, it, vi } from 'vitest';
import {
  BENIGN_TEARDOWN_ERROR_PATTERNS,
  boundedOnComplete,
  DEFAULT_TEARDOWN_TIMEOUT_MS,
  failStartup,
  isBenignTeardownError,
  PROCESS_TEARDOWN_TIMEOUT_MS,
  runBounded,
  safeDeleteSession,
} from '../src/teardown.js';

describe('isBenignTeardownError', () => {
  it('should match a benign error by message', () => {
    expect(isBenignTeardownError(new Error('WebSocket is not connected'))).toBe(true);
    expect(isBenignTeardownError(new Error('Session not found'))).toBe(true);
  });

  it('should match a benign error by error code', () => {
    expect(isBenignTeardownError(Object.assign(new Error('boom'), { code: 'UND_ERR_CLOSED' }))).toBe(true);
  });

  it('should match a plain string error', () => {
    expect(isBenignTeardownError('socket hang up')).toBe(true);
  });

  it('should not match an unrelated error', () => {
    expect(isBenignTeardownError(new Error('expected 1 to equal 2'))).toBe(false);
  });

  it('should not match undefined', () => {
    expect(isBenignTeardownError(undefined)).toBe(false);
  });

  it('should expose a non-empty pattern list', () => {
    expect(BENIGN_TEARDOWN_ERROR_PATTERNS.length).toBeGreaterThan(0);
  });
});

describe('runBounded', () => {
  it('should return the operation result when it settles before the timeout', async () => {
    await expect(runBounded(() => Promise.resolve('done'), 1000)).resolves.toBe('done');
  });

  it('should propagate a rejection from the operation', async () => {
    await expect(runBounded(() => Promise.reject(new Error('nope')), 1000)).rejects.toThrow('nope');
  });

  it('should resolve to undefined and call onTimeout when the operation stalls', async () => {
    vi.useFakeTimers();
    try {
      const onTimeout = vi.fn();
      const pending = runBounded(() => new Promise<string>(() => {}), 5000, onTimeout);
      await vi.advanceTimersByTimeAsync(5000);

      await expect(pending).resolves.toBeUndefined();
      expect(onTimeout).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should clear the timer when the operation settles first', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    try {
      await runBounded(() => Promise.resolve('x'), 5000);
      expect(clearSpy).toHaveBeenCalled();
    } finally {
      clearSpy.mockRestore();
    }
  });

  it('should swallow a late rejection from the abandoned op without an unhandledRejection', async () => {
    // Guards the no-op .catch on the abandoned op promise: if the timeout wins
    // and the stalled op rejects LATER (e.g. the OS resets the socket after the
    // deadline), that must not become an unhandledRejection — the very teardown
    // crash runBounded exists to prevent.
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      vi.useFakeTimers();
      let rejectOp!: (reason: unknown) => void;
      const pending = runBounded(
        () =>
          new Promise<string>((_, reject) => {
            rejectOp = reject;
          }),
        5000,
      );
      await vi.advanceTimersByTimeAsync(5000);
      await expect(pending).resolves.toBeUndefined();

      rejectOp(new Error('socket reset after teardown deadline'));
      vi.useRealTimers();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      process.off('unhandledRejection', unhandled);
    }
  });
});

describe('failStartup', () => {
  it('should rethrow the startup error unchanged when every teardown succeeds', async () => {
    const startupError = new Error('startup failed');
    const teardown = vi.fn().mockResolvedValue(undefined);

    await expect(failStartup(startupError, 'Widget standalone', teardown)).rejects.toBe(startupError);
    expect(teardown).toHaveBeenCalledTimes(1);
  });

  it('should rethrow the original value as-is (not wrapped) when it is not an Error', async () => {
    await expect(failStartup('boom', 'Widget standalone')).rejects.toBe('boom');
  });

  it('should run every teardown in order, best-effort, even when one throws', async () => {
    const order: string[] = [];
    const first = vi.fn(async () => {
      order.push('first');
    });
    const second = vi.fn(async () => {
      order.push('second');
      throw new Error('second failed');
    });
    const third = vi.fn(async () => {
      order.push('third');
    });

    await expect(failStartup(new Error('startup'), 'Widget standalone', first, second, third)).rejects.toBeInstanceOf(
      AggregateError,
    );
    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('should surface the startup error and every teardown failure in one AggregateError', async () => {
    const startupError = new Error('startup failed');
    const cleanupA = new Error('cleanup A failed');
    const cleanupB = new Error('cleanup B failed');

    const promise = failStartup(
      startupError,
      'Widget standalone',
      () => Promise.reject(cleanupA),
      () => Promise.reject(cleanupB),
    );

    await expect(promise).rejects.toMatchObject({
      name: 'AggregateError',
      message: 'Widget standalone startup and cleanup failed',
      cause: startupError,
    });
    const aggregate = await promise.catch((e: AggregateError) => e);
    expect(aggregate.errors).toEqual([startupError, cleanupA, cleanupB]);
  });

  it('should rethrow the startup error when given no teardowns', async () => {
    const startupError = new Error('startup failed');
    await expect(failStartup(startupError, 'Widget standalone')).rejects.toBe(startupError);
  });
});

describe('safeDeleteSession', () => {
  type BrowserArg = Parameters<typeof safeDeleteSession>[0];
  const makeLog = () => ({ warn: vi.fn(), debug: vi.fn() });
  const makeBrowser = (sessionId: string | undefined, deleteSession: () => Promise<unknown>): BrowserArg =>
    ({ sessionId, deleteSession }) as unknown as BrowserArg;

  it('should skip deletion and log nothing when there is no sessionId', async () => {
    const log = makeLog();
    const deleteSession = vi.fn().mockResolvedValue(undefined);
    await safeDeleteSession(makeBrowser(undefined, deleteSession), 'cleanup', log);

    expect(deleteSession).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.debug).not.toHaveBeenCalled();
  });

  it('should delete the session and log nothing on success', async () => {
    const log = makeLog();
    const deleteSession = vi.fn().mockResolvedValue(undefined);
    await safeDeleteSession(makeBrowser('session-1', deleteSession), 'cleanup', log);

    expect(deleteSession).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.debug).not.toHaveBeenCalled();
  });

  it('should swallow a benign failure and log it at debug, not warn', async () => {
    const log = makeLog();
    const deleteSession = vi.fn().mockRejectedValue(new Error('session not found'));

    await expect(safeDeleteSession(makeBrowser('session-1', deleteSession), 'cleanup', log)).resolves.toBeUndefined();
    expect(log.debug).toHaveBeenCalledOnce();
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('benign teardown error'));
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('should swallow a non-benign failure and log it at warn, not debug', async () => {
    const log = makeLog();
    const deleteSession = vi.fn().mockRejectedValue(new Error('unexpected boom'));

    await expect(safeDeleteSession(makeBrowser('session-1', deleteSession), 'cleanup', log)).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledOnce();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to delete session'));
    expect(log.debug).not.toHaveBeenCalled();
  });

  it('should warn and resolve when deleteSession stalls past the timeout', async () => {
    vi.useFakeTimers();
    try {
      const log = makeLog();
      const deleteSession = vi.fn(() => new Promise<void>(() => {}));
      const pending = safeDeleteSession(makeBrowser('session-1', deleteSession), 'cleanup', log);
      await vi.advanceTimersByTimeAsync(DEFAULT_TEARDOWN_TIMEOUT_MS);

      await expect(pending).resolves.toBeUndefined();
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('deleteSession timed out'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('should rethrow a non-benign failure when rethrow is set', async () => {
    const log = makeLog();
    const boom = new Error('unexpected boom');
    const deleteSession = vi.fn().mockRejectedValue(boom);

    await expect(
      safeDeleteSession(makeBrowser('session-1', deleteSession), 'afterSession', log, { rethrow: true }),
    ).rejects.toBe(boom);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('should still swallow a benign failure even when rethrow is set', async () => {
    const log = makeLog();
    const deleteSession = vi.fn().mockRejectedValue(new Error('session not found'));

    await expect(
      safeDeleteSession(makeBrowser('session-1', deleteSession), 'afterSession', log, { rethrow: true }),
    ).resolves.toBeUndefined();
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('benign teardown error'));
  });
});

describe('boundedOnComplete', () => {
  const makeLog = () => ({ warn: vi.fn() });

  it('should run the launcher onComplete and resolve', async () => {
    const log = makeLog();
    const onComplete = vi.fn().mockResolvedValue(undefined);
    await expect(boundedOnComplete({ onComplete }, 'cleanup', log)).resolves.toBeUndefined();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('should no-op for a launcher without onComplete (e.g. Flutter)', async () => {
    const log = makeLog();
    await expect(boundedOnComplete({}, 'cleanup', log)).resolves.toBeUndefined();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('should warn and swallow a failure by default', async () => {
    const log = makeLog();
    await expect(
      boundedOnComplete({ onComplete: () => Promise.reject(new Error('stop boom')) }, 'cleanup', log),
    ).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('onComplete() failed'));
  });

  it('should rethrow a failure when rethrow is set', async () => {
    const log = makeLog();
    await expect(
      boundedOnComplete({ onComplete: () => Promise.reject(new Error('stop boom')) }, 'cleanup', log, {
        rethrow: true,
      }),
    ).rejects.toThrow('stop boom');
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('should warn and resolve when onComplete stalls past the timeout', async () => {
    vi.useFakeTimers();
    try {
      const log = makeLog();
      const pending = boundedOnComplete({ onComplete: () => new Promise<void>(() => {}) }, 'cleanup', log);
      await vi.advanceTimersByTimeAsync(DEFAULT_TEARDOWN_TIMEOUT_MS);
      await expect(pending).resolves.toBeUndefined();
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('onComplete() timed out'));
    } finally {
      vi.useRealTimers();
    }
  });

  it('should honour a custom timeoutMs', async () => {
    vi.useFakeTimers();
    try {
      const log = makeLog();
      let settled = false;
      const pending = boundedOnComplete({ onComplete: () => new Promise<void>(() => {}) }, 'cleanup', log, {
        timeoutMs: PROCESS_TEARDOWN_TIMEOUT_MS,
      }).then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(DEFAULT_TEARDOWN_TIMEOUT_MS);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(PROCESS_TEARDOWN_TIMEOUT_MS - DEFAULT_TEARDOWN_TIMEOUT_MS);
      await pending;
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should warn about a failure that lands after the timeout', async () => {
    vi.useFakeTimers();
    try {
      const log = makeLog();
      let rejectStop!: (error: Error) => void;
      const onComplete = () =>
        new Promise<void>((_resolve, reject) => {
          rejectStop = reject;
        });
      const pending = boundedOnComplete({ onComplete }, 'cleanup', log, { rethrow: true });
      await vi.advanceTimersByTimeAsync(DEFAULT_TEARDOWN_TIMEOUT_MS);
      await expect(pending).resolves.toBeUndefined();

      rejectStop(new Error('embedded driver stop failed'));
      await vi.advanceTimersByTimeAsync(0);

      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('failed after timing out during cleanup'));
      expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('embedded driver stop failed'));
    } finally {
      vi.useRealTimers();
    }
  });
});
