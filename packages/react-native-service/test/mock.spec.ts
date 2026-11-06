import { createContext, runInContext } from 'node:vm';

import type { CdpBridge } from '@wdio/native-cdp-bridge';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMock, createMockAll } from '../src/mock.js';
import { ReactNativeMockStore } from '../src/mockStore.js';

// A fake CdpBridge whose `send` resolves normally while `open`, and rejects once
// `close()` is called — modelling a connection that was torn down by reconnect().
function fakeBridge() {
  let open = true;
  const send = vi.fn(async (_method: string, params?: { expression?: string }) => {
    if (!open) {
      throw new Error('WebSocket is closed');
    }
    // buildEnumerateFunctionsScript (mockAll) — return the discovered function names.
    if (params?.expression?.includes('getOwnPropertyNames')) {
      return { result: { value: ['greet', 'farewell'] } };
    }
    // buildReadCallDataScript reads call data — return an empty-but-valid shape.
    if (params?.expression?.includes('calls')) {
      return { result: { value: { calls: [], results: [], invocationCallOrder: [] } } };
    }
    return { result: { value: undefined } };
  });
  return {
    bridge: { send } as unknown as CdpBridge,
    close: () => {
      open = false;
    },
  };
}

describe('createMock', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should install an inner recorder and expose a ReactNativeMock', async () => {
    const store = new ReactNativeMockStore();
    const { bridge } = fakeBridge();
    const mock = await createMock('greet', bridge, store);
    expect(mock.__isReactNativeMock).toBe(true);
    expect(store.getMock('greet')).toBe(mock);
  });

  it('should push impl, run the callback, then pop impl in withImplementation', async () => {
    const store = new ReactNativeMockStore();
    const { bridge } = fakeBridge();
    const mock = await createMock('greet', bridge, store);
    const send = bridge.send as unknown as ReturnType<typeof vi.fn>;
    send.mockClear();

    const order: string[] = [];
    const sendExpr = () => send.mock.calls.map((c) => String((c[1] as { expression?: string })?.expression ?? ''));

    const result = await mock.withImplementation(
      () => 'temp',
      async () => {
        order.push('callback');
        return 'callback-result';
      },
    );

    expect(result).toBe('callback-result');
    const exprs = sendExpr();
    // push happens before the callback, pop after.
    expect(exprs.some((e) => e.includes('__pushImpl'))).toBe(true);
    expect(exprs.some((e) => e.includes('__popImpl'))).toBe(true);
    expect(exprs.findIndex((e) => e.includes('__pushImpl'))).toBeLessThan(
      exprs.findIndex((e) => e.includes('__popImpl')),
    );
  });

  it('should pop impl even if the withImplementation callback throws', async () => {
    const store = new ReactNativeMockStore();
    const { bridge } = fakeBridge();
    const mock = await createMock('greet', bridge, store);
    const send = bridge.send as unknown as ReturnType<typeof vi.fn>;
    send.mockClear();

    await expect(
      mock.withImplementation(
        () => 'temp',
        async () => {
          throw new Error('boom');
        },
      ),
    ).rejects.toThrow(/boom/);

    const exprs = send.mock.calls.map((c) => String((c[1] as { expression?: string })?.expression ?? ''));
    expect(exprs.some((e) => e.includes('__popImpl'))).toBe(true);
  });

  it('should surface the callback error, not the cleanup error, when popImpl also fails', async () => {
    const store = new ReactNativeMockStore();
    const send = vi.fn(async (_method: string, params?: { expression?: string }) => {
      // Match the pop *call* script (`...__popImpl()`), not the install script that
      // *defines* `spy.__popImpl = function`.
      if (params?.expression?.includes('__popImpl()')) {
        throw new Error('bridge dropped during pop');
      }
      if (params?.expression?.includes('calls')) {
        return { result: { value: { calls: [], results: [], invocationCallOrder: [] } } };
      }
      return { result: { value: undefined } };
    });
    const bridge = { send } as unknown as CdpBridge;
    const mock = await createMock('greet', bridge, store);

    await expect(
      mock.withImplementation(
        () => 'temp',
        async () => {
          throw new Error('original assertion failure');
        },
      ),
    ).rejects.toThrow(/original assertion failure/);
  });

  it('should not leak an unhandled rejection through mockClear after reconnect', async () => {
    const store = new ReactNativeMockStore();
    const first = fakeBridge();
    await createMock('greet', first.bridge, store);

    // Simulate MetroBridge.reconnect(): the old bridge is closed, a new one replaces it,
    // and createMock is called again for the same target.
    first.close();
    const second = fakeBridge();
    const remock = await createMock('greet', second.bridge, store);

    const rejections: unknown[] = [];
    const onRejection = (err: unknown) => rejections.push(err);
    process.on('unhandledRejection', onRejection);

    // mockClear/mockReset must route to the NEW bridge and clear native vitest state
    // via the stashed native bindings — never the old closed bridge.
    await remock.mockClear();
    await remock.mockReset();
    await new Promise((resolve) => setImmediate(resolve));

    process.off('unhandledRejection', onRejection);
    expect(rejections).toEqual([]);
    expect(second.bridge.send).toHaveBeenCalled();
  });

  it('should keep outer vitest state when the CDP clear call fails (dead bridge)', async () => {
    const store = new ReactNativeMockStore();
    const { bridge, close } = fakeBridge();
    const mock = await createMock('greet', bridge, store);
    const vitestFn = (mock as unknown as { _vitestFn: ReturnType<typeof vi.fn> })._vitestFn;
    vitestFn('arg'); // seed a call so there is state to clear
    expect(vitestFn.mock.calls).toHaveLength(1);

    close();

    await expect(mock.mockClear()).rejects.toThrow(/WebSocket is closed/);
    expect(vitestFn.mock.calls).toHaveLength(1);
  });

  it('should keep outer vitest state when the CDP reset call fails (dead bridge)', async () => {
    const store = new ReactNativeMockStore();
    const { bridge, close } = fakeBridge();
    const mock = await createMock('greet', bridge, store);
    const vitestFn = (mock as unknown as { _vitestFn: ReturnType<typeof vi.fn> })._vitestFn;
    vitestFn('arg');
    expect(vitestFn.mock.calls).toHaveLength(1);

    close();

    await expect(mock.mockReset()).rejects.toThrow(/WebSocket is closed/);
    expect(vitestFn.mock.calls).toHaveLength(1);
  });

  it('should keep outer vitest state and the store entry when the CDP restore call fails (dead bridge)', async () => {
    const store = new ReactNativeMockStore();
    const { bridge, close } = fakeBridge();
    const mock = await createMock('greet', bridge, store);
    const vitestFn = (mock as unknown as { _vitestFn: ReturnType<typeof vi.fn> })._vitestFn;
    vitestFn('arg');
    expect(vitestFn.mock.calls).toHaveLength(1);

    close();

    await expect(mock.mockRestore()).rejects.toThrow(/WebSocket is closed/);
    expect(vitestFn.mock.calls).toHaveLength(1);
    expect(store.getMock('greet')).toBeDefined();
  });

  it('should preserve call history across a reconnect (same vitest fn)', async () => {
    const store = new ReactNativeMockStore();
    const first = fakeBridge();
    const mock = await createMock('greet', first.bridge, store);
    const vitestFn = (mock as unknown as { _vitestFn: unknown })._vitestFn;

    first.close();
    const second = fakeBridge();
    const remock = await createMock('greet', second.bridge, store);
    expect((remock as unknown as { _vitestFn: unknown })._vitestFn).toBe(vitestFn);
  });
});

// Two chains whose nodes link to each other and back, like React fibers and their alternates.
function crossLinked(depth: number) {
  type Node = { child?: Node; alternate?: Node };
  const a: Node[] = Array.from({ length: depth }, () => ({}));
  const b: Node[] = Array.from({ length: depth }, () => ({}));
  for (let i = 0; i < depth; i++) {
    a[i].alternate = b[i];
    b[i].alternate = a[i];
    a[i].child = a[i + 1];
    b[i].child = b[i + 1];
  }
  return a[0];
}

describe('createMock call data', () => {
  // Runs the real inner-recorder scripts in a vm realm and clones the result as CDP's returnByValue does.
  function realmBridge(initial: Record<string, unknown>) {
    const ctx = createContext({ ...initial });
    const send = vi.fn(async (_method: string, params: { expression: string }) => {
      const value = await Promise.resolve(runInContext(params.expression, ctx));
      return { result: { value: value === undefined ? undefined : JSON.parse(JSON.stringify(value)) } };
    });
    return { bridge: { send } as unknown as CdpBridge, ctx };
  }

  it('should keep undefined arguments, nested or not, instead of turning them into null', async () => {
    const { bridge, ctx } = realmBridge({ greet: () => 'orig' });
    const mock = await createMock('greet', bridge, new ReactNativeMockStore());
    const greet = ctx.greet as (...a: unknown[]) => unknown;

    greet({ a: 1 }, undefined);
    greet([1, undefined], { b: undefined }, null);

    await mock.update();

    expect(mock.mock.calls).toStrictEqual([
      [{ a: 1 }, undefined],
      [[1, undefined], { b: undefined }, null],
    ]);
    expect(mock).toHaveBeenCalledWith({ a: 1 }, undefined);
  });

  it('should read an object in each call that passes it, and each object once per call', async () => {
    const { bridge, ctx } = realmBridge({ greet: () => 'orig' });
    const mock = await createMock('greet', bridge, new ReactNativeMockStore());
    const greet = ctx.greet as (...a: unknown[]) => unknown;
    const cfg = { a: 1 };

    greet(cfg);
    greet(cfg);
    greet(crossLinked(20));

    await mock.update();

    expect(mock.mock.calls.slice(0, 2)).toStrictEqual([[{ a: 1 }], [{ a: 1 }]]);
    // Following every path through the graph instead would double the output per level
    expect(JSON.stringify(mock.mock.calls[2]).length).toBeLessThan(5_000);
  });
});

describe('createMockAll', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should mock every enumerated function under the target path', async () => {
    const store = new ReactNativeMockStore();
    const { bridge } = fakeBridge();
    const mocks = await createMockAll('Clipboard', bridge, store);

    expect(Object.keys(mocks).sort()).toEqual(['farewell', 'greet']);
    expect(mocks.greet.__isReactNativeMock).toBe(true);
    // each enumerated function is registered under its full dotted path
    expect(store.getMock('Clipboard.greet')).toBe(mocks.greet);
    expect(store.getMock('Clipboard.farewell')).toBe(mocks.farewell);
  });
});
