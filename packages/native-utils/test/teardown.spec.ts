import { describe, expect, it, vi } from 'vitest';
import {
  BENIGN_TEARDOWN_ERROR_PATTERNS,
  DEFAULT_TEARDOWN_TIMEOUT_MS,
  deleteSessionBounded,
  isBenignTeardownError,
  runBounded,
  runTeardownStep,
} from '../src/teardown.js';

describe('isBenignTeardownError', () => {
  it('should match a benign error by message', () => {
    expect(isBenignTeardownError(new Error('WebSocket is not connected'))).toBe(true);
    expect(isBenignTeardownError(new Error('Session not found'))).toBe(true);
  });

  it('should match a window-already-gone error', () => {
    expect(isBenignTeardownError(new Error('no such window: target window already closed'))).toBe(true);
    expect(isBenignTeardownError(new Error('chrome not reachable'))).toBe(true);
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

describe('runTeardownStep', () => {
  const createLog = () => ({ debug: vi.fn(), warn: vi.fn() });

  it('should run the step without logging when it succeeds', async () => {
    const log = createLog();
    const op = vi.fn().mockResolvedValue('ok');

    await expect(runTeardownStep(log, 'step', op)).resolves.toBeUndefined();
    expect(op).toHaveBeenCalledTimes(1);
    expect(log.debug).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('should debug-log a benign error', async () => {
    const log = createLog();
    const error = new Error('WebSocket is not connected');

    await expect(runTeardownStep(log, 'step', () => Promise.reject(error))).resolves.toBeUndefined();
    expect(log.debug).toHaveBeenCalledWith('Ignoring benign teardown error during step:', error);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('should warn-log any other error', async () => {
    const log = createLog();
    const error = new Error('unexpected');

    await expect(runTeardownStep(log, 'step', () => Promise.reject(error))).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith('step failed during teardown:', error);
  });

  it('should catch a synchronous throw from the step', async () => {
    const log = createLog();
    const error = new Error('sync');

    await expect(
      runTeardownStep(log, 'step', () => {
        throw error;
      }),
    ).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith('step failed during teardown:', error);
  });

  it('should give up on a stalled step after the default teardown timeout', async () => {
    vi.useFakeTimers();
    try {
      const log = createLog();
      const pending = runTeardownStep(log, 'step', () => new Promise(() => {}));
      await vi.advanceTimersByTimeAsync(DEFAULT_TEARDOWN_TIMEOUT_MS);

      await expect(pending).resolves.toBeUndefined();
      expect(log.warn).toHaveBeenCalledWith('step timed out during teardown');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('deleteSessionBounded', () => {
  const createLog = () => ({ debug: vi.fn(), warn: vi.fn() });

  it('should delete a live session', async () => {
    const browser = { sessionId: 'sess-1', deleteSession: vi.fn().mockResolvedValue(undefined) };

    await deleteSessionBounded(createLog(), browser, 'cleanup');

    expect(browser.deleteSession).toHaveBeenCalledTimes(1);
  });

  it('should skip when the session is already gone', async () => {
    const browser = { sessionId: undefined, deleteSession: vi.fn() };

    await deleteSessionBounded(createLog(), browser);
    await deleteSessionBounded(createLog(), undefined);

    expect(browser.deleteSession).not.toHaveBeenCalled();
  });

  it('should name the step after the context when logging a failure', async () => {
    const log = createLog();
    const error = new Error('unexpected');
    const browser = { sessionId: 'sess-1', deleteSession: vi.fn().mockRejectedValue(error) };

    await expect(deleteSessionBounded(log, browser, 'instance a')).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith('deleteSession (instance a) failed during teardown:', error);
  });
});
