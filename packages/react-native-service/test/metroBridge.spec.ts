import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  connect: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
  lastOptions: undefined as Record<string, unknown> | undefined,
}));

vi.mock('../src/hermesBridge.js', () => ({
  createHermesBridge: (options: Record<string, unknown>) => {
    h.lastOptions = options;
    // `state` mirrors CdpBridge's WebSocket readyState (1 = OPEN); MetroBridge.connected now
    // reads it for liveness rather than mere allocation.
    return { connect: h.connect, close: h.close, send: vi.fn(), state: 1 };
  },
}));

import { MetroBridge } from '../src/metroBridge.js';

beforeEach(() => {
  h.connect.mockClear();
  h.close.mockClear();
  h.lastOptions = undefined;
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
});
