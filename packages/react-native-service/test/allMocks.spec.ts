import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearAllMocks, isMockFunction, resetAllMocks, restoreAllMocks } from '../src/commands/allMocks.js';
import { ReactNativeMockStore } from '../src/mockStore.js';

function fakeMock(target: string) {
  return {
    __isReactNativeMock: true as const,
    mockClear: vi.fn(async () => {}),
    mockReset: vi.fn(async () => {}),
    mockRestore: vi.fn(async () => {}),
    _target: target,
  } as unknown as import('@wdio/native-types').ReactNativeMock;
}

function storeWith(...targets: string[]) {
  const store = new ReactNativeMockStore();
  for (const t of targets) {
    store.setMock(t, fakeMock(t));
  }
  return store;
}

describe('clearAllMocks', () => {
  it('should call mockClear on every stored mock', async () => {
    const store = storeWith('a.x', 'b.y');
    await clearAllMocks(store);
    for (const [, mock] of store.getMocks()) {
      expect(mock.mockClear).toHaveBeenCalledOnce();
    }
  });

  it('should filter by prefix', async () => {
    const store = storeWith('api.fetch', 'api2.post', 'api.get');
    await clearAllMocks(store, 'api');
    const mocks = Object.fromEntries(store.getMocks());
    expect(mocks['api.fetch'].mockClear).toHaveBeenCalledOnce();
    expect(mocks['api.get'].mockClear).toHaveBeenCalledOnce();
    expect(mocks['api2.post'].mockClear).not.toHaveBeenCalled();
  });

  it('should continue on per-mock failure', async () => {
    const store = storeWith('a', 'b');
    const [, first] = store.getMocks()[0];
    vi.mocked(first.mockClear).mockRejectedValueOnce(new Error('boom'));
    await expect(clearAllMocks(store)).resolves.toBeUndefined();
    const [, second] = store.getMocks()[1];
    expect(second.mockClear).toHaveBeenCalledOnce();
  });
});

describe('resetAllMocks', () => {
  it('should call mockReset on every stored mock', async () => {
    const store = storeWith('a');
    await resetAllMocks(store);
    expect(store.getMocks()[0][1].mockReset).toHaveBeenCalledOnce();
  });
});

describe('restoreAllMocks', () => {
  it('should call mockRestore on every stored mock', async () => {
    const store = storeWith('a');
    await restoreAllMocks(store);
    expect(store.getMocks()[0][1].mockRestore).toHaveBeenCalledOnce();
  });
});

describe('isMockFunction', () => {
  it('should return true for a callable with the sentinel', () => {
    const store = new ReactNativeMockStore();
    const callable = Object.assign(() => {}, { __isReactNativeMock: true as const });
    expect(isMockFunction(callable, store)).toBe(true);
  });

  it('should return true for a target string that is in the store', () => {
    const store = storeWith('a.b');
    expect(isMockFunction('a.b', store)).toBe(true);
  });

  it('should return false for a target string not in the store', () => {
    const store = new ReactNativeMockStore();
    expect(isMockFunction('a.b', store)).toBe(false);
  });

  it('should return false for a plain function', () => {
    const store = new ReactNativeMockStore();
    expect(isMockFunction(() => {}, store)).toBe(false);
  });

  it('should return false for null/undefined', () => {
    const store = new ReactNativeMockStore();
    expect(isMockFunction(null, store)).toBe(false);
    expect(isMockFunction(undefined, store)).toBe(false);
  });
});
