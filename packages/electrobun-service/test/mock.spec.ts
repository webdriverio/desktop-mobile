import vm from 'node:vm';

import type { MultiTargetCdpBridge as CdpBridge } from '@wdio/native-cdp-bridge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock at the boundary — the CdpBridge — not the local modules. send() runs the
// emitted Runtime.evaluate expression in a Node vm sandbox holding a shared
// `window`, so the actual inner-recorder JS (innerRecorder.ts) is exercised
// end-to-end: install → record real calls → read-back → impl/return/clear/etc.
// (No CEF in unit tests; the in-webview round-trip itself is only fully proven
// against a real app — see the E2E-validation gap note in the PR.)
vi.mock('@wdio/native-cdp-bridge', () => ({ MultiTargetCdpBridge: class {} }));

import { createMock } from '../src/mock.js';
import { ElectrobunMockStore } from '../src/mockStore.js';

interface FakeWindow {
  __WDIO_ELECTROBUN_MOCKS__?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * A bridge whose `send('Runtime.evaluate', { expression })` runs the expression
 * against a persistent sandbox. The expression form the service emits is
 * `(function(){ ... })()` / `(async()=>{...})()`, which `vm.runInContext`
 * evaluates and returns. Results are JSON-cloned to mimic CDP returnByValue.
 */
function makeBridge(initialWindow: FakeWindow = {}): {
  bridge: CdpBridge;
  send: ReturnType<typeof vi.fn>;
  window: FakeWindow;
} {
  const window = initialWindow;
  const sandbox: { window: FakeWindow } = { window };
  // Inside the page `window.x` and bare `x` are the same global; expose both.
  vm.createContext(sandbox);
  Object.defineProperty(sandbox, 'globalThis', { value: sandbox });

  const send = vi.fn(async (method: string, params: { expression: string }) => {
    if (method !== 'Runtime.evaluate') {
      throw new Error(`unexpected CDP method ${method}`);
    }
    const value = vm.runInContext(params.expression, sandbox);
    const resolved = await Promise.resolve(value);
    // returnByValue semantics: serialise then revive.
    const cloned = resolved === undefined ? undefined : JSON.parse(JSON.stringify(resolved));
    return { result: { value: cloned } };
  });

  const bridge = { send } as unknown as CdpBridge;
  return { bridge, send, window };
}

describe('createMock (Electrobun mocking)', () => {
  let store: ElectrobunMockStore;

  beforeEach(() => {
    store = new ElectrobunMockStore();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('install', () => {
    it('should inject the inner recorder over the dotted target path on mock()', async () => {
      const { bridge, window } = makeBridge({ api: { fetchData: () => 'real' } });

      await createMock('api.fetchData', bridge, store);

      const reg = window.__WDIO_ELECTROBUN_MOCKS__ as Record<string, { original: unknown }>;
      expect(reg['api.fetchData']).toBeDefined();
      // The live function is now the spy, not the original.
      expect((window.api as { fetchData: unknown }).fetchData).not.toBe(reg['api.fetchData'].original);
    });

    it('should register the outer mock in the store and flag it as an electrobun mock', async () => {
      const { bridge } = makeBridge({ api: { fetchData: () => 1 } });

      const mock = await createMock('api.fetchData', bridge, store);

      expect(store.getMock('api.fetchData')).toBe(mock);
      expect((mock as unknown as { __isElectrobunMock: boolean }).__isElectrobunMock).toBe(true);
      expect(mock.getMockName()).toBe('electrobun.api.fetchData');
    });

    it('should reject a target that is not a valid dotted property path', async () => {
      const { bridge, send } = makeBridge({ api: { fetchData: () => 1 } });

      await expect(createMock("api['fetch-data']", bridge, store)).rejects.toThrow(/valid dotted property path/);
      await expect(createMock("x'); doEvil(); //", bridge, store)).rejects.toThrow(/valid dotted property path/);
      // Rejected before any script reaches the page.
      expect(send).not.toHaveBeenCalled();
    });

    it('should throw inside the page when the target is not a function', async () => {
      const { bridge } = makeBridge({ api: { fetchData: 42 } });

      await expect(createMock('api.fetchData', bridge, store)).rejects.toThrow(/is not a function/);
    });

    it('should return the existing handle (idempotent install) when re-mocking the same target', async () => {
      const { bridge, send } = makeBridge({ api: { fetchData: () => 1 } });

      const first = await createMock('api.fetchData', bridge, store);
      send.mockClear();
      const second = await createMock('api.fetchData', bridge, store);

      expect(second).toBe(first);
      // Install re-runs (idempotent in-page) but no second outer mock is built.
      expect(store.getMocks()).toHaveLength(1);
    });
  });

  describe('update', () => {
    it('should read inner call data back and populate the outer mock.calls/results', async () => {
      const { bridge, window } = makeBridge({ api: { fetchData: () => 'real' } });
      const mock = await createMock('api.fetchData', bridge, store);

      // Drive real calls through the installed spy in the page.
      const spy = (window.api as { fetchData: (...a: unknown[]) => unknown }).fetchData;
      spy('a', 1);
      spy('b', 2);

      await mock.update();

      expect(mock.mock.calls).toEqual([
        ['a', 1],
        ['b', 2],
      ]);
      expect(mock.mock.results).toHaveLength(2);
      expect(mock.mock.invocationCallOrder).toHaveLength(2);
    });

    it('should replace outer state wholesale when the inner history shrinks', async () => {
      const { bridge, window } = makeBridge({ api: { fetchData: () => 1 } });
      const mock = await createMock('api.fetchData', bridge, store);
      const spy = (window.api as { fetchData: (...a: unknown[]) => unknown }).fetchData;

      spy('x');
      await mock.update();
      expect(mock.mock.calls).toEqual([['x']]);

      await mock.mockClear();
      await mock.update();
      expect(mock.mock.calls).toEqual([]);
    });
  });

  describe('behaviour setters push to the inner recorder', () => {
    it('should make the inner spy return the mockReturnValue', async () => {
      const { bridge, window } = makeBridge({ api: { fetchData: () => 'real' } });
      const mock = await createMock('api.fetchData', bridge, store);

      await mock.mockReturnValue(99);

      const spy = (window.api as { fetchData: () => unknown }).fetchData;
      expect(spy()).toBe(99);
    });

    it('should make the inner spy resolve the mockResolvedValue', async () => {
      const { bridge, window } = makeBridge({ api: { fetchData: () => 'real' } });
      const mock = await createMock('api.fetchData', bridge, store);

      await mock.mockResolvedValue({ ok: true });

      const spy = (window.api as { fetchData: () => Promise<unknown> }).fetchData;
      await expect(spy()).resolves.toEqual({ ok: true });
    });

    it('should reconstruct an Error for mockRejectedValue inside the page', async () => {
      const { bridge, window } = makeBridge({ api: { fetchData: () => 'real' } });
      const mock = await createMock('api.fetchData', bridge, store);

      await mock.mockRejectedValue(new Error('boom'));

      const spy = (window.api as { fetchData: () => Promise<unknown> }).fetchData;
      await expect(spy()).rejects.toThrow(/boom/);
    });

    it('should preserve the Error name and stack through reconstruction', async () => {
      const { bridge, window } = makeBridge({ api: { fetchData: () => 'real' } });
      const mock = await createMock('api.fetchData', bridge, store);
      const original = new TypeError('bad shape');
      original.stack = 'TypeError: bad shape\n    at original (api.ts:1:1)';

      await mock.mockRejectedValue(original);

      const spy = (window.api as { fetchData: () => Promise<unknown> }).fetchData;
      const rejected = await spy().then(
        () => undefined,
        (e: Error) => e,
      );
      expect(rejected?.name).toBe('TypeError');
      expect(rejected?.stack).toBe(original.stack);
    });

    it('should run the pushed mockImplementation in the page', async () => {
      const { bridge, window } = makeBridge({ api: { add: () => 0 } });
      const mock = await createMock('api.add', bridge, store);

      await mock.mockImplementation((...args: unknown[]) => (args[0] as number) + (args[1] as number));

      const spy = (window.api as { add: (...a: unknown[]) => unknown }).add;
      expect(spy(2, 3)).toBe(5);
    });

    it('should label in-page failures with the mock context, not execute', async () => {
      const failing = {
        send: vi.fn(async () => ({ exceptionDetails: { text: 'boom' } })),
      } as unknown as CdpBridge;

      await expect(createMock('api.fetchData', failing, store)).rejects.toThrow(
        'browser.electrobun.mock("api.fetchData") failed: boom',
      );
    });

    it('should reject a native function passed as a mockImplementation', async () => {
      const { bridge } = makeBridge({ api: { fetchData: () => 1 } });
      const mock = await createMock('api.fetchData', bridge, store);

      await expect(mock.mockImplementation(Array.prototype.push as (...args: unknown[]) => unknown)).rejects.toThrow(
        /native or bound functions/,
      );
    });

    it('should round-trip a mockReturnValue containing U+2028/U+2029', async () => {
      const { bridge, window } = makeBridge({ api: { fetchData: () => 1 } });
      const mock = await createMock('api.fetchData', bridge, store);

      await mock.mockReturnValue('a\u2028b\u2029c');

      const spy = (window.api as { fetchData: () => unknown }).fetchData;
      expect(spy()).toBe('a\u2028b\u2029c');
    });

    it('should round-trip a mockRejectedValue whose message contains U+2028', async () => {
      const { bridge, window } = makeBridge({ api: { fetchData: () => 1 } });
      const mock = await createMock('api.fetchData', bridge, store);

      await mock.mockRejectedValue(new Error('line\u2028break'));

      const spy = (window.api as { fetchData: () => Promise<unknown> }).fetchData;
      const rejected = await spy().then(
        () => undefined,
        (e: Error) => e,
      );
      expect(rejected?.message).toBe('line\u2028break');
    });

    it('should reject a method shorthand passed as a mockImplementation', async () => {
      const { bridge } = makeBridge({ api: { fetchData: () => 1 } });
      const mock = await createMock('api.fetchData', bridge, store);
      const shorthand = {
        fetch(x: unknown) {
          return x;
        },
      }.fetch;

      await expect(mock.mockImplementation(shorthand as (...args: unknown[]) => unknown)).rejects.toThrow(
        /method shorthands/,
      );
    });

    it('should reject a function passed as a mockReturnValue (not JSON-serialisable)', async () => {
      const { bridge } = makeBridge({ api: { fetchData: () => 1 } });
      const mock = await createMock('api.fetchData', bridge, store);

      await expect(mock.mockReturnValue(() => 1)).rejects.toThrow(/not JSON-serialisable/);
    });
  });

  describe('lifecycle', () => {
    it('should clear inner + outer call history on mockClear', async () => {
      const { bridge, window } = makeBridge({ api: { fetchData: () => 1 } });
      const mock = await createMock('api.fetchData', bridge, store);
      const spy = (window.api as { fetchData: (...a: unknown[]) => unknown }).fetchData;

      spy('x');
      await mock.update();
      expect(mock.mock.calls).toHaveLength(1);

      await mock.mockClear();
      expect(mock.mock.calls).toHaveLength(0);
      // Inner cleared too: a fresh read shows no calls.
      await mock.update();
      expect(mock.mock.calls).toHaveLength(0);
    });

    it('should reset the inner implementation on mockReset and keep the mock name', async () => {
      const { bridge, window } = makeBridge({ api: { fetchData: () => 1 } });
      const mock = await createMock('api.fetchData', bridge, store);

      await mock.mockReturnValue(7);
      const spy = (window.api as { fetchData: () => unknown }).fetchData;
      expect(spy()).toBe(7);

      await mock.mockReset();
      // Default behaviour after reset is undefined.
      expect(spy()).toBeUndefined();
      expect(mock.getMockName()).toBe('electrobun.api.fetchData');
    });

    it('should restore the original function and drop the store entry on mockRestore', async () => {
      const original = (): string => 'real';
      const { bridge, window } = makeBridge({ api: { fetchData: original } });
      const mock = await createMock('api.fetchData', bridge, store);

      expect((window.api as { fetchData: unknown }).fetchData).not.toBe(original);

      await mock.mockRestore();

      expect((window.api as { fetchData: unknown }).fetchData).toBe(original);
      expect(store.getMock('api.fetchData')).toBeUndefined();
      expect(window.__WDIO_ELECTROBUN_MOCKS__?.['api.fetchData']).toBeUndefined();
    });
  });
});
