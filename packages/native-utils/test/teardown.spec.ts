import { describe, expect, it, vi } from 'vitest';
import { BENIGN_TEARDOWN_ERROR_PATTERNS, isBenignTeardownError, runBounded } from '../src/teardown.js';

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
});
