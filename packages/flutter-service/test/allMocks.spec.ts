import { describe, expect, it, vi } from 'vitest';

import { clearAllMocks, isMockFunction, resetAllMocks, restoreAllMocks } from '../src/commands/allMocks.js';
import { FlutterMockStore } from '../src/mockStore.js';

const makeMock = (over: Record<string, unknown> = {}) =>
  ({
    mockClear: vi.fn().mockResolvedValue(undefined),
    mockReset: vi.fn().mockResolvedValue(undefined),
    mockRestore: vi.fn().mockResolvedValue(undefined),
    __isFlutterMock: true,
    ...over,
  }) as never;

describe('clear/reset/restoreAllMocks', () => {
  it('should clear every mock', async () => {
    const store = new FlutterMockStore();
    const m = makeMock();
    store.setMock('A.b', m);
    await clearAllMocks(store);
    expect((m as unknown as { mockClear: ReturnType<typeof vi.fn> }).mockClear).toHaveBeenCalled();
  });

  it('should reset every mock', async () => {
    const store = new FlutterMockStore();
    const m = makeMock();
    store.setMock('A.b', m);
    await resetAllMocks(store);
    expect((m as unknown as { mockReset: ReturnType<typeof vi.fn> }).mockReset).toHaveBeenCalled();
  });

  it('should restore every mock', async () => {
    const store = new FlutterMockStore();
    const m = makeMock();
    store.setMock('A.b', m);
    await restoreAllMocks(store);
    expect((m as unknown as { mockRestore: ReturnType<typeof vi.fn> }).mockRestore).toHaveBeenCalled();
  });

  it('should filter by target prefix', async () => {
    const store = new FlutterMockStore();
    const a = makeMock();
    const b = makeMock();
    store.setMock('A.x', a);
    store.setMock('B.y', b);
    await clearAllMocks(store, 'A');
    expect((a as unknown as { mockClear: ReturnType<typeof vi.fn> }).mockClear).toHaveBeenCalled();
    expect((b as unknown as { mockClear: ReturnType<typeof vi.fn> }).mockClear).not.toHaveBeenCalled();
  });

  it('should continue past a failing entry', async () => {
    const store = new FlutterMockStore();
    const bad = makeMock({ mockClear: vi.fn().mockRejectedValue(new Error('boom')) });
    const good = makeMock();
    store.setMock('A.x', bad);
    store.setMock('A.y', good);
    await clearAllMocks(store);
    expect((good as unknown as { mockClear: ReturnType<typeof vi.fn> }).mockClear).toHaveBeenCalled();
  });
});

describe('isMockFunction', () => {
  it('should be true for a known target string', () => {
    const store = new FlutterMockStore();
    store.setMock('A.b', makeMock());
    expect(isMockFunction('A.b', store)).toBe(true);
  });

  it('should be false for an unknown string', () => {
    expect(isMockFunction('nope', new FlutterMockStore())).toBe(false);
  });

  it('should be true for a __isFlutterMock function', () => {
    const fn = Object.assign(() => undefined, { __isFlutterMock: true });
    expect(isMockFunction(fn, new FlutterMockStore())).toBe(true);
  });

  it('should be false for a plain value', () => {
    expect(isMockFunction(123, new FlutterMockStore())).toBe(false);
  });
});
