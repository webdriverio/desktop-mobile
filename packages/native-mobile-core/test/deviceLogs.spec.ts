import { describe, expect, it, vi } from 'vitest';

const { error, warn, debug } = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), debug: vi.fn() }));
vi.mock('@wdio/native-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wdio/native-utils')>();
  return { ...actual, createLogger: () => ({ debug, info: vi.fn(), warn, error }) };
});

import { collectDeviceLogs, forwardDeviceLogs } from '../src/deviceLogs.js';

describe('collectDeviceLogs', () => {
  it('should map raw Appium logs to LogEntry tagged source=device', async () => {
    const browser = {
      getLogs: vi.fn().mockResolvedValue([{ timestamp: 1, level: 'INFO', message: 'hi' }]),
    } as unknown as WebdriverIO.Browser;
    expect(await collectDeviceLogs(browser, 'logcat')).toEqual([
      { timestamp: 1, level: 'INFO', message: 'hi', source: 'device' },
    ]);
  });

  it('should return [] (and not throw) when getLogs is unavailable', async () => {
    const browser = {
      getLogs: vi.fn().mockRejectedValue(new Error('no logcat')),
    } as unknown as WebdriverIO.Browser;
    expect(await collectDeviceLogs(browser, 'syslog')).toEqual([]);
  });
});

describe('forwardDeviceLogs', () => {
  it('should route entries to the logger by level', () => {
    error.mockClear();
    warn.mockClear();
    debug.mockClear();
    forwardDeviceLogs([
      { timestamp: 1, level: 'ERROR', message: 'e', source: 'device' },
      { timestamp: 1, level: 'WARN', message: 'w', source: 'device' },
      { timestamp: 1, level: 'INFO', message: 'i', source: 'device' },
    ]);
    expect(error).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
    expect(debug).toHaveBeenCalledOnce();
  });
});
