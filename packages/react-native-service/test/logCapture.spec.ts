import type { CdpBridge } from '@wdio/native-cdp-bridge';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { forwardDeviceLogs, startJsLogForwarding } from '../src/logCapture.js';

// vi.hoisted: the vi.mock factory is hoisted above module init, so logMock must be too.
const logMock = vi.hoisted(() => ({
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@wdio/native-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wdio/native-utils')>();
  return { ...actual, createLogger: () => logMock };
});

function fakeBridge() {
  return {
    send: vi.fn(async () => ({})),
    on: vi.fn(),
    off: vi.fn(),
  };
}

/** Subscribe, then return the registered consoleAPICalled handler so tests can feed it events. */
async function getHandler(minLevel?: Parameters<typeof startJsLogForwarding>[1]) {
  const bridge = fakeBridge();
  await startJsLogForwarding(bridge as unknown as CdpBridge, minLevel);
  return bridge.on.mock.calls[0][1] as (params: unknown) => void;
}

beforeEach(() => {
  for (const fn of Object.values(logMock)) {
    fn.mockClear();
  }
});

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
    // Log capture is opt-in (captureFrontendLogs) and must never break execute/mock.
    const bridge = fakeBridge();
    bridge.send = vi.fn(async () => {
      throw new Error('bridge closed');
    });
    const stop = await startJsLogForwarding(bridge as unknown as CdpBridge);
    expect(bridge.on).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
    expect(bridge.off).not.toHaveBeenCalled();
  });

  it('should forward each console type at the matching logger level', async () => {
    const handler = await getHandler('debug');
    handler({ type: 'error', args: [{ value: 'boom' }] });
    handler({ type: 'warning', args: [{ value: 'careful' }] });
    handler({ type: 'info', args: [{ value: 'fyi' }] });
    handler({ type: 'log', args: [{ value: 'plain' }] });
    expect(logMock.error).toHaveBeenCalledWith('[JS] boom');
    expect(logMock.warn).toHaveBeenCalledWith('[JS] careful');
    expect(logMock.info).toHaveBeenCalledWith('[JS] fyi');
    // console.log maps to info (captured at the default info level).
    expect(logMock.info).toHaveBeenCalledWith('[JS] plain');
  });

  it('should drop events below the default (info) frontendLogLevel', async () => {
    const handler = await getHandler(); // default 'info'
    handler({ type: 'debug', args: [{ value: 'noise' }] });
    expect(logMock.debug).not.toHaveBeenCalled();
    expect(logMock.info).not.toHaveBeenCalled();
  });

  it('should respect an explicit frontendLogLevel (warn drops info)', async () => {
    const handler = await getHandler('warn');
    handler({ type: 'info', args: [{ value: 'dropped' }] });
    handler({ type: 'error', args: [{ value: 'kept' }] });
    expect(logMock.info).not.toHaveBeenCalled();
    expect(logMock.error).toHaveBeenCalledWith('[JS] kept');
  });
});

describe('forwardDeviceLogs', () => {
  const entry = (level: string, message: string) => ({ timestamp: 0, level, message, source: 'device' as const });

  it('should filter device entries below the minimum level', () => {
    forwardDeviceLogs([entry('DEBUG', 'd'), entry('INFO', 'i'), entry('ERROR', 'e')], 'info');
    expect(logMock.debug).not.toHaveBeenCalled(); // DEBUG < info → dropped
    expect(logMock.info).toHaveBeenCalledWith('[DEVICE:INFO] i');
    expect(logMock.error).toHaveBeenCalledWith('[DEVICE:ERROR] e');
  });

  it('should map fatal to error and forward at default info level', () => {
    forwardDeviceLogs([entry('FATAL', 'kaboom')]);
    expect(logMock.error).toHaveBeenCalledWith('[DEVICE:FATAL] kaboom');
  });
});
