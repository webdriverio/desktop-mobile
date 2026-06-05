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
