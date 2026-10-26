import { beforeEach, describe, expect, it, vi } from 'vitest';

const { driverLog } = vi.hoisted(() => ({
  driverLog: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@wdio/native-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wdio/native-utils')>();
  return {
    ...actual,
    createLogger: () => driverLog,
  };
});

import { forwardDriverLine } from '../src/logForwarder.js';

const infoLine = 'tauri-driver listening on 127.0.0.1:4444';
const debugLine = 'DEBUG tauri-driver variable dump';
const errorLine = 'WebKitWebDriver ERROR failed to bind';

describe('tauri-driver output', () => {
  beforeEach(() => {
    driverLog.debug.mockClear();
    driverLog.info.mockClear();
    driverLog.warn.mockClear();
    driverLog.error.mockClear();
  });

  it('should print info driver lines at the default level and hide debug lines', () => {
    forwardDriverLine(infoLine, undefined, {});
    forwardDriverLine(debugLine, undefined, {});
    expect(driverLog.info).toHaveBeenCalledWith(infoLine);
    expect(driverLog.debug).not.toHaveBeenCalled();
  });

  it('should print debug driver lines when the level is debug', () => {
    forwardDriverLine(debugLine, undefined, { logLevel: 'debug' });
    expect(driverLog.debug).toHaveBeenCalledWith(debugLine);
  });

  it('should print only error driver lines when the level is error', () => {
    forwardDriverLine(infoLine, undefined, { logLevel: 'error' });
    forwardDriverLine(errorLine, undefined, { logLevel: 'error' });
    expect(driverLog.info).not.toHaveBeenCalled();
    expect(driverLog.error).toHaveBeenCalledWith(errorLine);
  });

  it('should leave app logs out of the driver logger', () => {
    forwardDriverLine('INFO app started', undefined, { logLevel: 'trace' });
    expect(driverLog.info).not.toHaveBeenCalled();
    expect(driverLog.debug).not.toHaveBeenCalled();
  });
});
