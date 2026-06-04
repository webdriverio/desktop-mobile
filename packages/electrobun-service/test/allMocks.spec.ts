import vm from 'node:vm';

import type { MultiTargetCdpBridge as CdpBridge } from '@wdio/cdp-bridge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@wdio/cdp-bridge', () => ({ MultiTargetCdpBridge: class {} }));

import { clearAllMocks, isMockFunction, resetAllMocks, restoreAllMocks } from '../src/commands/allMocks.js';
import { createMock } from '../src/mock.js';
import { ElectrobunMockStore } from '../src/mockStore.js';

interface FakeWindow {
  __WDIO_ELECTROBUN_MOCKS__?: Record<string, unknown>;
  [key: string]: unknown;
}

function makeBridge(initialWindow: FakeWindow): { bridge: CdpBridge; window: FakeWindow } {
  const sandbox: { window: FakeWindow } = { window: initialWindow };
  vm.createContext(sandbox);
  Object.defineProperty(sandbox, 'globalThis', { value: sandbox });
  const send = vi.fn(async (_method: string, params: { expression: string }) => {
    const value = await Promise.resolve(vm.runInContext(params.expression, sandbox));
    return { result: { value: value === undefined ? undefined : JSON.parse(JSON.stringify(value)) } };
  });
  return { bridge: { send } as unknown as CdpBridge, window: initialWindow };
}

describe('allMocks helpers', () => {
  let store: ElectrobunMockStore;

  beforeEach(() => {
    store = new ElectrobunMockStore();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('isMockFunction', () => {
    it('should return true for an ElectrobunMock', async () => {
      const { bridge } = makeBridge({ api: { a: () => 1 } });
      const mock = await createMock('api.a', bridge, store);
      expect(isMockFunction(mock, store)).toBe(true);
    });

    it('should return true for a registered target-path string', async () => {
      const { bridge } = makeBridge({ api: { a: () => 1 } });
      await createMock('api.a', bridge, store);
      expect(isMockFunction('api.a', store)).toBe(true);
      expect(isMockFunction('api.unknown', store)).toBe(false);
    });

    it('should return false for a plain function or non-function', () => {
      expect(isMockFunction(() => 1, store)).toBe(false);
      expect(isMockFunction(undefined, store)).toBe(false);
      expect(isMockFunction(42, store)).toBe(false);
    });
  });

  describe('clear/reset/restore all', () => {
    it('should clear history across all mocks', async () => {
      const { bridge, window } = makeBridge({ api: { a: () => 1, b: () => 2 } });
      const a = await createMock('api.a', bridge, store);
      const b = await createMock('api.b', bridge, store);
      (window.api as { a: () => unknown }).a();
      (window.api as { b: () => unknown }).b();
      await a.update();
      await b.update();
      expect(a.mock.calls).toHaveLength(1);
      expect(b.mock.calls).toHaveLength(1);

      await clearAllMocks(store);

      expect(a.mock.calls).toHaveLength(0);
      expect(b.mock.calls).toHaveLength(0);
    });

    it('should honour a prefix filter', async () => {
      const { bridge, window } = makeBridge({ fs: { read: () => 1 }, net: { get: () => 2 } });
      const read = await createMock('fs.read', bridge, store);
      const get = await createMock('net.get', bridge, store);
      (window.fs as { read: () => unknown }).read();
      (window.net as { get: () => unknown }).get();
      await read.update();
      await get.update();

      await clearAllMocks(store, 'fs.');

      expect(read.mock.calls).toHaveLength(0);
      expect(get.mock.calls).toHaveLength(1);
    });

    it('should not clear a sibling namespace that shares a prefix string', async () => {
      const { bridge, window } = makeBridge({ api: { a: () => 1 }, api2: { b: () => 2 } });
      const a = await createMock('api.a', bridge, store);
      const b = await createMock('api2.b', bridge, store);
      (window.api as { a: () => unknown }).a();
      (window.api2 as { b: () => unknown }).b();
      await a.update();
      await b.update();

      await clearAllMocks(store, 'api');

      expect(a.mock.calls).toHaveLength(0);
      expect(b.mock.calls).toHaveLength(1);
    });

    it('should continue the bulk op when one mock throws', async () => {
      const { bridge, window } = makeBridge({ api: { a: () => 1, b: () => 2 } });
      const a = await createMock('api.a', bridge, store);
      const b = await createMock('api.b', bridge, store);
      (window.api as { a: () => unknown }).a();
      (window.api as { b: () => unknown }).b();
      await a.update();
      await b.update();
      expect(a.mock.calls).toHaveLength(1);
      expect(b.mock.calls).toHaveLength(1);
      vi.spyOn(a, 'mockClear').mockRejectedValueOnce(new Error('cdp connection dropped'));

      await clearAllMocks(store);

      // a threw and was skipped, but b must still be cleared.
      expect(b.mock.calls).toHaveLength(0);
    });

    it('should reset implementations across all mocks', async () => {
      const { bridge, window } = makeBridge({ api: { a: () => 1 } });
      const a = await createMock('api.a', bridge, store);
      await a.mockReturnValue(5);
      expect((window.api as { a: () => unknown }).a()).toBe(5);

      await resetAllMocks(store);

      expect((window.api as { a: () => unknown }).a()).toBeUndefined();
    });

    it('should restore originals and empty the store on restoreAllMocks', async () => {
      const origA = (): string => 'a';
      const origB = (): string => 'b';
      const { bridge, window } = makeBridge({ api: { a: origA, b: origB } });
      await createMock('api.a', bridge, store);
      await createMock('api.b', bridge, store);

      await restoreAllMocks(store);

      expect((window.api as { a: unknown }).a).toBe(origA);
      expect((window.api as { b: unknown }).b).toBe(origB);
      expect(store.getMocks()).toHaveLength(0);
    });
  });
});
