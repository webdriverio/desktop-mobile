import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  connect: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  lastOptions: undefined as Record<string, unknown> | undefined,
  // Each createHermesBridge call pushes its bridge here so a test can flip `isOpen` to false
  // (simulate a dropped socket) on a specific bridge instance.
  bridges: [] as { isOpen: boolean }[],
}));

vi.mock('../src/hermesBridge.js', () => ({
  createHermesBridge: (options: Record<string, unknown>) => {
    h.lastOptions = options;
    // MetroBridge.connected reads CdpBridge.isOpen for liveness (OPEN socket), not mere
    // allocation; a freshly connected mock bridge is open until a test marks it dead.
    const bridge = { connect: h.connect, close: h.close, send: vi.fn(), isOpen: true };
    h.bridges.push(bridge);
    return bridge;
  },
}));

import { MetroBridge } from '../src/metroBridge.js';

beforeEach(() => {
  h.connect.mockClear();
  h.close.mockClear();
  h.lastOptions = undefined;
  h.bridges.length = 0;
});

describe('MetroBridge', () => {
  it('should run adb reverse then connect on Android', async () => {
    const adbReverse = vi.fn(async () => {});
    const metro = new MetroBridge({ platform: 'android', port: 8081, adbReverse });
    await metro.connect();
    expect(adbReverse).toHaveBeenCalledWith(8081);
    expect(h.connect).toHaveBeenCalledOnce();
    expect(metro.connected).toBe(true);
  });

  it('should not run adb reverse on iOS', async () => {
    const adbReverse = vi.fn(async () => {});
    const metro = new MetroBridge({ platform: 'ios', adbReverse });
    await metro.connect();
    expect(adbReverse).not.toHaveBeenCalled();
    expect(h.connect).toHaveBeenCalledOnce();
  });

  it('should continue connecting when adb reverse fails', async () => {
    const adbReverse = vi.fn(async () => {
      throw new Error('no device');
    });
    const metro = new MetroBridge({ platform: 'android', adbReverse });
    await metro.connect();
    expect(h.connect).toHaveBeenCalledOnce();
    expect(metro.connected).toBe(true);
  });

  it('should be idempotent on repeated connect()', async () => {
    const metro = new MetroBridge({ platform: 'ios', adbReverse: vi.fn(async () => {}) });
    await metro.connect();
    await metro.connect();
    expect(h.connect).toHaveBeenCalledOnce();
  });

  it('should coalesce concurrent connect() calls into a single connection', async () => {
    // The `#connecting ??=` guard exists to dedupe genuinely concurrent first-use callers
    // (e.g. execute and mock awaited together). Sequential calls clear `#connecting` via finally
    // before the next, so only concurrency exercises the short-circuit.
    const metro = new MetroBridge({ platform: 'ios', adbReverse: vi.fn(async () => {}) });
    await Promise.all([metro.connect(), metro.connect(), metro.connect()]);
    expect(h.connect).toHaveBeenCalledOnce();
    expect(h.bridges).toHaveLength(1);
    expect(metro.connected).toBe(true);
  });

  it('should close a dead (dropped-socket) bridge before reconnecting', async () => {
    const metro = new MetroBridge({ platform: 'ios', adbReverse: vi.fn(async () => {}) });
    await metro.connect();
    expect(metro.connected).toBe(true);

    // Socket drops (app backgrounded → Hermes inspector suspends): bridge is still non-null but
    // no longer OPEN, so connect() must close it before opening a fresh one rather than leaking it.
    h.bridges[0].isOpen = false;
    expect(metro.connected).toBe(false);

    await metro.connect();
    expect(h.close).toHaveBeenCalledOnce();
    expect(h.connect).toHaveBeenCalledTimes(2);
    expect(h.bridges).toHaveLength(2);
    expect(metro.connected).toBe(true);
  });

  it('should throw when the bridge is accessed before connect()', () => {
    const metro = new MetroBridge();
    expect(() => metro.bridge).toThrow(/not connected/);
  });

  it('should close and reset the connection', async () => {
    const metro = new MetroBridge({ platform: 'ios', adbReverse: vi.fn(async () => {}) });
    await metro.connect();
    await metro.close();
    expect(h.close).toHaveBeenCalledOnce();
    expect(metro.connected).toBe(false);
  });

  it('should reconnect by closing then connecting again', async () => {
    const metro = new MetroBridge({ platform: 'ios', adbReverse: vi.fn(async () => {}) });
    await metro.connect();
    await metro.reconnect();
    expect(h.close).toHaveBeenCalledOnce();
    expect(h.connect).toHaveBeenCalledTimes(2);
    expect(metro.connected).toBe(true);
  });

  it('should default the Metro host and port', async () => {
    const metro = new MetroBridge({ platform: 'ios', adbReverse: vi.fn(async () => {}) });
    await metro.connect();
    expect(h.lastOptions).toMatchObject({ host: 'localhost', port: 8081 });
  });

  it('should not orphan a bridge when close() races #doConnect()', async () => {
    // Regression: close() called while #doConnect() is suspended at bridge.connect()
    // previously returned before the new bridge was assigned, leaving the socket open.
    let resolveConnect!: () => void;
    const connectGate = new Promise<void>((r) => {
      resolveConnect = r;
    });
    h.connect.mockImplementationOnce(() => connectGate);

    const metro = new MetroBridge({ platform: 'ios', adbReverse: vi.fn(async () => {}) });

    // Start connect; it suspends inside the gate above, so #doConnect is in-flight.
    const connectPromise = metro.connect();
    // close() must await the in-flight connect before tearing down.
    const closePromise = metro.close();

    // Let the pending bridge.connect() resolve — #doConnect assigns #bridge.
    resolveConnect();
    await connectPromise;
    await closePromise;

    // close() should have closed the bridge that #doConnect assigned, not left it open.
    expect(h.close).toHaveBeenCalledOnce();
    expect(metro.connected).toBe(false);
  });
});
