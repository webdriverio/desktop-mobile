import type { CdpBridge } from '@wdio/native-cdp-bridge';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMock } from '../src/mock.js';
import { ReactNativeMockStore } from '../src/mockStore.js';

// A fake CdpBridge whose `send` resolves normally while `open`, and rejects once
// `close()` is called — modelling a connection that was torn down by reconnect().
function fakeBridge() {
  let open = true;
  const send = vi.fn(async (_method: string, params?: { expression?: string }) => {
    if (!open) {
      throw new Error('WebSocket is closed');
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
