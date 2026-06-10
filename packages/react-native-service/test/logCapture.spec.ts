import type { CdpBridge } from '@wdio/native-cdp-bridge';
import { describe, expect, it, vi } from 'vitest';

import { startJsLogForwarding } from '../src/logCapture.js';

function fakeBridge() {
  return {
    send: vi.fn(async () => ({})),
    on: vi.fn(),
    off: vi.fn(),
  };
}

describe('startJsLogForwarding', () => {
  it('should enable the Runtime domain before subscribing to consoleAPICalled', async () => {
    // Runtime.consoleAPICalled is only dispatched after Runtime.enable — without this the
    // capture silently drops every event (the regression this guards, #348 review).
    const bridge = fakeBridge();
    await startJsLogForwarding(bridge as unknown as CdpBridge);

    expect(bridge.send).toHaveBeenCalledWith('Runtime.enable');
    expect(bridge.on).toHaveBeenCalledWith('Runtime.consoleAPICalled', expect.any(Function));
    // enable must precede the subscription, else the initial replayed batch is missed.
    expect(bridge.send.mock.invocationCallOrder[0]).toBeLessThan(bridge.on.mock.invocationCallOrder[0]);
  });

  it('should return a cleanup that removes the listener', async () => {
    const bridge = fakeBridge();
    const stop = await startJsLogForwarding(bridge as unknown as CdpBridge);
    stop();
    expect(bridge.off).toHaveBeenCalledWith('Runtime.consoleAPICalled', expect.any(Function));
  });

  it('should not subscribe and must not throw when Runtime.enable fails (best-effort)', async () => {
    // Log capture is opt-in (captureBackendLogs) and must never break execute/mock.
    const bridge = fakeBridge();
    bridge.send = vi.fn(async () => {
      throw new Error('bridge closed');
    });
    const stop = await startJsLogForwarding(bridge as unknown as CdpBridge);
    expect(bridge.on).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
    expect(bridge.off).not.toHaveBeenCalled();
  });
});
