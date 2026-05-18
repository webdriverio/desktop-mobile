import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const isLogWriterInitialized = vi.fn();
const getLogWriter = vi.fn();
const shouldLog = vi.fn();
const debug = vi.fn();
const info = vi.fn();
const warn = vi.fn();
const error = vi.fn();
const writerWrite = vi.fn();

vi.mock('@wdio/native-core', () => ({
  isLogWriterInitialized: (...args: unknown[]) => isLogWriterInitialized(...args),
  getLogWriter: (...args: unknown[]) => getLogWriter(...args),
  shouldLog: (...args: unknown[]) => shouldLog(...args),
}));

vi.mock('@wdio/native-utils', () => ({
  createLogger: () => ({ debug, info, warn, error }),
}));

describe('forwardLog', () => {
  beforeEach(() => {
    vi.resetModules();
    isLogWriterInitialized.mockReset().mockReturnValue(false);
    getLogWriter.mockReset().mockReturnValue({ write: writerWrite });
    shouldLog.mockReset().mockReturnValue(true);
    debug.mockReset();
    info.mockReset();
    warn.mockReset();
    error.mockReset();
    writerWrite.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should suppress the log when shouldLog returns false', async () => {
    shouldLog.mockReturnValue(false);
    const { forwardLog } = await import('../src/logForwarder.js');

    forwardLog('backend', 'debug', 'hidden', 'info');

    expect(info).not.toHaveBeenCalled();
    expect(writerWrite).not.toHaveBeenCalled();
  });

  it('should route to the WDIO logger when no LogWriter is initialised', async () => {
    isLogWriterInitialized.mockReturnValue(false);
    const { forwardLog } = await import('../src/logForwarder.js');

    forwardLog('backend', 'info', 'hello', 'info');

    expect(info).toHaveBeenCalledWith('[Dioxus:Backend] hello');
    expect(writerWrite).not.toHaveBeenCalled();
  });

  it('should route to the LogWriter file when one is initialised', async () => {
    isLogWriterInitialized.mockReturnValue(true);
    const { forwardLog } = await import('../src/logForwarder.js');

    forwardLog('backend', 'info', 'to-file', 'info');

    expect(writerWrite).toHaveBeenCalledWith('[Dioxus:Backend] to-file');
    expect(info).not.toHaveBeenCalled();
  });

  it('should use the frontend prefix for frontend source', async () => {
    isLogWriterInitialized.mockReturnValue(false);
    const { forwardLog } = await import('../src/logForwarder.js');

    forwardLog('frontend', 'warn', 'browser warning', 'info');

    expect(warn).toHaveBeenCalledWith('[Dioxus:Frontend] browser warning');
  });

  it('should inject the instance ID into the prefix for multiremote', async () => {
    isLogWriterInitialized.mockReturnValue(false);
    const { forwardLog } = await import('../src/logForwarder.js');

    forwardLog('backend', 'info', 'mr', 'info', 'browserA');

    expect(info).toHaveBeenCalledWith('[Dioxus:Backend:browserA] mr');
  });

  it('should map trace + debug levels to the debug logger method', async () => {
    isLogWriterInitialized.mockReturnValue(false);
    const { forwardLog } = await import('../src/logForwarder.js');

    forwardLog('backend', 'debug', 'd', 'debug');
    forwardLog('backend', 'trace', 't', 'trace');

    expect(debug).toHaveBeenCalledTimes(2);
  });
});
