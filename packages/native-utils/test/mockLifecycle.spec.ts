import { describe, expect, it, vi } from 'vitest';

import { registerLocalMockOps, runBulkMockOp } from '../src/mockLifecycle.js';

function fakeMock() {
  return {
    mockClear: vi.fn().mockResolvedValue(undefined),
    mockReset: vi.fn().mockResolvedValue(undefined),
    mockRestore: vi.fn().mockResolvedValue(undefined),
  };
}

describe('runBulkMockOp', () => {
  it('should run the op on every mock and resolve with the count', async () => {
    const a = fakeMock();
    const b = fakeMock();

    await expect(
      runBulkMockOp(
        [
          ['a', a],
          ['b', b],
        ],
        'mockRestore',
      ),
    ).resolves.toBe(2);

    expect(a.mockRestore).toHaveBeenCalledOnce();
    expect(b.mockRestore).toHaveBeenCalledOnce();
  });

  it('should only run the op on mocks the matcher accepts', async () => {
    const a = fakeMock();
    const b = fakeMock();

    await expect(
      runBulkMockOp(
        [
          ['api.a', a],
          ['other.b', b],
        ],
        'mockClear',
        { matches: (name) => name.startsWith('api.') },
      ),
    ).resolves.toBe(1);

    expect(a.mockClear).toHaveBeenCalledOnce();
    expect(b.mockClear).not.toHaveBeenCalled();
  });

  it('should attempt every mock and then throw an AggregateError of the failures', async () => {
    const first = fakeMock();
    const second = fakeMock();
    const third = fakeMock();
    const firstError = new Error('inner recorder missing');
    first.mockReset.mockRejectedValue(firstError);
    third.mockReset.mockRejectedValue(undefined);

    const result = runBulkMockOp(
      [
        ['first', first],
        ['second', second],
        ['third', third],
      ],
      'mockReset',
    );

    await expect(result).rejects.toBeInstanceOf(AggregateError);
    await expect(result).rejects.toMatchObject({
      errors: [firstError, undefined],
      message: 'mockReset failed: first: inner recorder missing; third: undefined',
    });
    expect(second.mockReset).toHaveBeenCalledOnce();
    expect(third.mockReset).toHaveBeenCalledOnce();
  });

  it('should report a failed bulk app call with the per-mock failures and still run every mock', async () => {
    const a = fakeMock();
    const b = fakeMock();
    b.mockRestore.mockRejectedValue(new Error('b failed'));

    const result = runBulkMockOp(
      [
        ['a', a],
        ['b', b],
      ],
      'mockRestore',
      { bulkAppCall: () => Promise.reject(new Error('script error')) },
    );

    await expect(result).rejects.toMatchObject({
      message: 'mockRestore failed: all mocks (in-app): script error; b: b failed',
    });
    expect(a.mockRestore).toHaveBeenCalledOnce();
    expect(b.mockRestore).toHaveBeenCalledOnce();
  });

  it('should skip the remaining app calls but run every local half once the app is unreachable', async () => {
    const dead = fakeMock();
    const withLocal = fakeMock();
    const withoutLocal = fakeMock();
    const deadLocal = vi.fn();
    const local = vi.fn();
    registerLocalMockOps(dead, { mockRestore: deadLocal });
    registerLocalMockOps(withLocal, { mockRestore: local });
    const connectionError = new Error('WebSocket is not connected');
    dead.mockRestore.mockRejectedValue(connectionError);

    const result = runBulkMockOp(
      [
        ['dead', dead],
        ['withLocal', withLocal],
        ['withoutLocal', withoutLocal],
      ],
      'mockRestore',
    );

    await expect(result).rejects.toMatchObject({
      errors: [connectionError],
      message:
        'mockRestore failed: dead: WebSocket is not connected ' +
        '(app unreachable: skipped the app call for 2 other mock(s))',
    });
    expect(withLocal.mockRestore).not.toHaveBeenCalled();
    expect(withoutLocal.mockRestore).not.toHaveBeenCalled();
    expect(local).toHaveBeenCalledOnce();
    // The failed mock's own method already ran its local half; the helper doesn't repeat it.
    expect(deadLocal).not.toHaveBeenCalled();
  });

  it('should keep making app calls for mocks on a healthy connection when another connection is gone', async () => {
    const browserA = {};
    const browserB = {};
    const deadA = fakeMock();
    const healthyB = fakeMock();
    const otherA = fakeMock();
    const healthyBLocal = vi.fn();
    const otherALocal = vi.fn();
    registerLocalMockOps(deadA, {}, browserA);
    registerLocalMockOps(healthyB, { mockRestore: healthyBLocal }, browserB);
    registerLocalMockOps(otherA, { mockRestore: otherALocal }, browserA);
    deadA.mockRestore.mockRejectedValue(new Error('invalid session id'));

    await expect(
      runBulkMockOp(
        [
          ['deadA', deadA],
          ['healthyB', healthyB],
          ['otherA', otherA],
        ],
        'mockRestore',
      ),
    ).rejects.toMatchObject({ errors: [expect.objectContaining({ message: 'invalid session id' })] });

    expect(healthyB.mockRestore).toHaveBeenCalledOnce();
    expect(healthyBLocal).not.toHaveBeenCalled();
    expect(otherA.mockRestore).not.toHaveBeenCalled();
    expect(otherALocal).toHaveBeenCalledOnce();
  });

  it('should only skip the mocks on the connection a failed bulk app call used', async () => {
    const browserA = {};
    const browserB = {};
    const onA = fakeMock();
    const onB = fakeMock();
    registerLocalMockOps(onA, {}, browserA);
    registerLocalMockOps(onB, {}, browserB);

    await expect(
      runBulkMockOp(
        [
          ['onA', onA],
          ['onB', onB],
        ],
        'mockReset',
        { bulkAppCall: () => Promise.reject(new Error('invalid session id')), bulkAppConnection: browserA },
      ),
    ).rejects.toBeInstanceOf(AggregateError);

    expect(onA.mockReset).not.toHaveBeenCalled();
    expect(onB.mockReset).toHaveBeenCalledOnce();
  });

  it('should treat a timed-out app call as an unreachable app', async () => {
    const stalled = fakeMock();
    const next = fakeMock();
    stalled.mockClear.mockRejectedValue(new Error('Request timeout exceeded waiting for response: 7'));

    await expect(
      runBulkMockOp(
        [
          ['stalled', stalled],
          ['next', next],
        ],
        'mockClear',
      ),
    ).rejects.toBeInstanceOf(AggregateError);

    expect(next.mockClear).not.toHaveBeenCalled();
  });

  it('should skip every per-mock app call when the bulk app call finds the app unreachable', async () => {
    const a = fakeMock();
    const local = vi.fn();
    registerLocalMockOps(a, { mockReset: local });

    await expect(
      runBulkMockOp([['a', a]], 'mockReset', {
        bulkAppCall: () => Promise.reject(new Error('invalid session id')),
      }),
    ).rejects.toMatchObject({ errors: [expect.objectContaining({ message: 'invalid session id' })] });

    expect(a.mockReset).not.toHaveBeenCalled();
    expect(local).toHaveBeenCalledOnce();
  });
});
