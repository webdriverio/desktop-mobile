import { describe, expect, it, vi } from 'vitest';

import { runBulkMockOp, runThenSync } from '../src/mockLifecycle.js';

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
});

describe('runThenSync', () => {
  it('should sync after the run and resolve with its result', async () => {
    const order: string[] = [];
    const mock = { update: vi.fn(async () => order.push('update')) };

    const run = async () => {
      order.push('run');
      return 'result';
    };

    await expect(runThenSync(mock, run)).resolves.toBe('result');
    expect(order).toEqual(['run', 'update']);
  });

  it('should sync, then reject with the error, when the run rejects', async () => {
    const mock = { update: vi.fn().mockResolvedValue(undefined) };

    await expect(runThenSync(mock, () => Promise.reject(new Error('run failed')))).rejects.toMatchObject({
      message: 'run failed',
    });
    expect(mock.update).toHaveBeenCalledOnce();
  });

  it("should reject with the run's error when the sync fails too", async () => {
    const mock = { update: vi.fn().mockRejectedValue(new Error('sync failed')) };

    await expect(runThenSync(mock, () => Promise.reject(new Error('run failed')))).rejects.toMatchObject({
      message: 'run failed',
    });
  });

  it('should reject with the sync error when only the sync fails', async () => {
    const mock = { update: vi.fn().mockRejectedValue(new Error('sync failed')) };

    await expect(runThenSync(mock, async () => 'result')).rejects.toMatchObject({ message: 'sync failed' });
  });
});
