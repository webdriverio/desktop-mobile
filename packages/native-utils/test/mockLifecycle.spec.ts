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

  it('should go local-only after two consecutive connection failures, including the failed mocks', async () => {
    const first = fakeMock();
    const second = fakeMock();
    const withLocal = fakeMock();
    const withoutLocal = fakeMock();
    const firstLocal = vi.fn();
    const secondLocal = vi.fn();
    const local = vi.fn();
    registerLocalMockOps(first, { mockClear: firstLocal });
    registerLocalMockOps(second, { mockClear: secondLocal });
    registerLocalMockOps(withLocal, { mockClear: local });
    first.mockClear.mockRejectedValue(new Error('WebSocket is not connected'));
    second.mockClear.mockRejectedValue(new Error('socket hang up'));

    const result = runBulkMockOp(
      [
        ['first', first],
        ['second', second],
        ['withLocal', withLocal],
        ['withoutLocal', withoutLocal],
      ],
      'mockClear',
    );

    await expect(result).rejects.toMatchObject({
      message:
        'mockClear failed: first: WebSocket is not connected; second: socket hang up ' +
        '(app unreachable: skipped the app call for 2 other mock(s))',
    });
    expect(withLocal.mockClear).not.toHaveBeenCalled();
    expect(withoutLocal.mockClear).not.toHaveBeenCalled();
    expect(local).toHaveBeenCalledOnce();
    expect(firstLocal).toHaveBeenCalledOnce();
    expect(secondLocal).toHaveBeenCalledOnce();
  });

  it('should keep making app calls after a single connection failure, and a success resets the count', async () => {
    const blip = fakeMock();
    const ok = fakeMock();
    const laterBlip = fakeMock();
    const last = fakeMock();
    const blipLocal = vi.fn();
    registerLocalMockOps(blip, { mockReset: blipLocal });
    blip.mockReset.mockRejectedValue(new Error('socket hang up'));
    laterBlip.mockReset.mockRejectedValue(new Error('socket hang up'));

    await expect(
      runBulkMockOp(
        [
          ['blip', blip],
          ['ok', ok],
          ['laterBlip', laterBlip],
          ['last', last],
        ],
        'mockReset',
      ),
    ).rejects.toBeInstanceOf(AggregateError);

    expect(ok.mockReset).toHaveBeenCalledOnce();
    expect(last.mockReset).toHaveBeenCalledOnce();
    expect(blipLocal).not.toHaveBeenCalled();
  });

  it('should keep making app calls for mocks on a healthy connection when another connection is gone', async () => {
    const browserA = {};
    const browserB = {};
    const deadA = fakeMock();
    const healthyB = fakeMock();
    const alsoDeadA = fakeMock();
    const otherA = fakeMock();
    const otherALocal = vi.fn();
    registerLocalMockOps(deadA, {}, browserA);
    registerLocalMockOps(healthyB, {}, browserB);
    registerLocalMockOps(alsoDeadA, {}, browserA);
    registerLocalMockOps(otherA, { mockRestore: otherALocal }, browserA);
    deadA.mockRestore.mockRejectedValue(new Error('invalid session id'));
    alsoDeadA.mockRestore.mockRejectedValue(new Error('invalid session id'));

    await expect(
      runBulkMockOp(
        [
          ['deadA', deadA],
          ['healthyB', healthyB],
          ['alsoDeadA', alsoDeadA],
          ['otherA', otherA],
        ],
        'mockRestore',
      ),
    ).rejects.toBeInstanceOf(AggregateError);

    expect(healthyB.mockRestore).toHaveBeenCalledOnce();
    expect(otherA.mockRestore).not.toHaveBeenCalled();
    expect(otherALocal).toHaveBeenCalledOnce();
  });

  it('should count a failed bulk app call towards its own connection only', async () => {
    const browserA = {};
    const browserB = {};
    const onA = fakeMock();
    const onB = fakeMock();
    const laterOnA = fakeMock();
    registerLocalMockOps(onA, {}, browserA);
    registerLocalMockOps(onB, {}, browserB);
    registerLocalMockOps(laterOnA, {}, browserA);
    onA.mockReset.mockRejectedValue(new Error('invalid session id'));

    await expect(
      runBulkMockOp(
        [
          ['onA', onA],
          ['onB', onB],
          ['laterOnA', laterOnA],
        ],
        'mockReset',
        { bulkAppCall: () => Promise.reject(new Error('invalid session id')), bulkAppConnection: browserA },
      ),
    ).rejects.toBeInstanceOf(AggregateError);

    expect(onA.mockReset).toHaveBeenCalledOnce();
    expect(onB.mockReset).toHaveBeenCalledOnce();
    expect(laterOnA.mockReset).not.toHaveBeenCalled();
  });

  it('should keep making app calls after failures that only mention a timeout', async () => {
    const namedTimeout = fakeMock();
    const slow = fakeMock();
    const next = fakeMock();
    namedTimeout.mockClear.mockRejectedValue(
      new Error('browser.electrobun.mock("Api.timeout") failed: TypeError: recorder is not a function'),
    );
    slow.mockClear.mockRejectedValue(new Error('script timeout'));

    await expect(
      runBulkMockOp(
        [
          ['Api.timeout', namedTimeout],
          ['slow', slow],
          ['next', next],
        ],
        'mockClear',
      ),
    ).rejects.toBeInstanceOf(AggregateError);

    expect(next.mockClear).toHaveBeenCalledOnce();
  });
});
