import { beforeEach, describe, expect, it, vi } from 'vitest';
import { forwardLog, shouldLog } from '../src/logForwarder.js';

vi.mock('@wdio/native-utils', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('@wdio/native-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@wdio/native-core')>()),
  isLogWriterInitialized: vi.fn(() => false),
  getLogWriter: vi.fn(),
}));

describe('logForwarder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('shouldLog', () => {
    it('should return true when log level meets minimum level', () => {
      expect(shouldLog('error', 'info')).toBe(true);
      expect(shouldLog('warn', 'info')).toBe(true);
      expect(shouldLog('info', 'info')).toBe(true);
    });

    it('should return false when log level is below minimum level', () => {
      expect(shouldLog('debug', 'info')).toBe(false);
      expect(shouldLog('trace', 'info')).toBe(false);
      expect(shouldLog('info', 'warn')).toBe(false);
    });

    it('should handle all log levels correctly', () => {
      // trace (0) is lowest
      expect(shouldLog('trace', 'trace')).toBe(true);
      expect(shouldLog('debug', 'trace')).toBe(true);
      expect(shouldLog('info', 'trace')).toBe(true);

      // debug (1)
      expect(shouldLog('trace', 'debug')).toBe(false);
      expect(shouldLog('debug', 'debug')).toBe(true);
      expect(shouldLog('info', 'debug')).toBe(true);

      // info (2)
      expect(shouldLog('debug', 'info')).toBe(false);
      expect(shouldLog('info', 'info')).toBe(true);
      expect(shouldLog('warn', 'info')).toBe(true);

      // warn (3)
      expect(shouldLog('info', 'warn')).toBe(false);
      expect(shouldLog('warn', 'warn')).toBe(true);
      expect(shouldLog('error', 'warn')).toBe(true);

      // error (4) is highest
      expect(shouldLog('warn', 'error')).toBe(false);
      expect(shouldLog('error', 'error')).toBe(true);
    });
  });

  describe('forwardLog', () => {
    it('should format main process log with correct prefix', async () => {
      const { createLogger } = await import('@wdio/native-utils');
      const mockLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      vi.mocked(createLogger).mockReturnValue(mockLogger as never);

      forwardLog('main', 'info', 'Test message', 'info');

      expect(mockLogger.info).toHaveBeenCalledWith('[Electron:MainProcess] Test message');
    });

    it('should format renderer process log with correct prefix', async () => {
      const { createLogger } = await import('@wdio/native-utils');
      const mockLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      vi.mocked(createLogger).mockReturnValue(mockLogger as never);

      forwardLog('renderer', 'info', 'Test message', 'info');

      expect(mockLogger.info).toHaveBeenCalledWith('[Electron:Renderer] Test message');
    });

    it('should include instance ID in prefix when provided', async () => {
      const { createLogger } = await import('@wdio/native-utils');
      const mockLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      vi.mocked(createLogger).mockReturnValue(mockLogger as never);

      forwardLog('main', 'info', 'Test message', 'info', 'app1');

      expect(mockLogger.info).toHaveBeenCalledWith('[Electron:MainProcess:app1] Test message');
    });

    it('should not log when level is below minimum', async () => {
      const { createLogger } = await import('@wdio/native-utils');
      const mockLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      vi.mocked(createLogger).mockReturnValue(mockLogger as never);

      forwardLog('main', 'debug', 'Test message', 'info');

      expect(mockLogger.debug).not.toHaveBeenCalled();
      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('should use correct logger method for each level', async () => {
      const { createLogger } = await import('@wdio/native-utils');
      const mockLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };
      vi.mocked(createLogger).mockReturnValue(mockLogger as never);

      forwardLog('main', 'debug', 'Debug message', 'debug');
      expect(mockLogger.debug).toHaveBeenCalled();

      forwardLog('main', 'trace', 'Trace message', 'trace');
      expect(mockLogger.debug).toHaveBeenCalledTimes(2); // trace maps to debug

      forwardLog('main', 'info', 'Info message', 'info');
      expect(mockLogger.info).toHaveBeenCalled();

      forwardLog('main', 'warn', 'Warn message', 'warn');
      expect(mockLogger.warn).toHaveBeenCalled();

      forwardLog('main', 'error', 'Error message', 'error');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should use log writer when initialized', async () => {
      const { isLogWriterInitialized, getLogWriter } = await import('@wdio/native-core');
      const mockWriter = { write: vi.fn() };

      vi.mocked(isLogWriterInitialized).mockReturnValue(true);
      vi.mocked(getLogWriter).mockReturnValue(mockWriter as never);

      forwardLog('main', 'info', 'Test message', 'info');

      expect(mockWriter.write).toHaveBeenCalledWith('[Electron:MainProcess] Test message');
    });

    it('should use WDIO logger when standalone writer not initialized', async () => {
      const { createLogger } = await import('@wdio/native-utils');
      const { isLogWriterInitialized } = await import('@wdio/native-core');
      const mockLogger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      };

      vi.mocked(isLogWriterInitialized).mockReturnValue(false);
      vi.mocked(createLogger).mockReturnValue(mockLogger as never);

      forwardLog('main', 'info', 'Test message', 'info');

      expect(mockLogger.info).toHaveBeenCalledWith('[Electron:MainProcess] Test message');
    });
  });
});
