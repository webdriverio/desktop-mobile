import { describe, expect, it, vi } from 'vitest';
import { BENIGN_TEARDOWN_ERROR_PATTERNS, failStartup, isBenignTeardownError, runBounded } from '../src/teardown.js';

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
