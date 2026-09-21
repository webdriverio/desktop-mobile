import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoggerMethods = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock('@wdio/native-utils', () => ({
  createLogger: vi.fn(() => mockLoggerMethods),
}));

vi.mock('@wdio/native-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@wdio/native-core')>()),
  isLogWriterInitialized: vi.fn(() => false),
  getLogWriter: vi.fn(),
}));

describe('logForwarder', () => {
  describe('shouldLog', () => {
    it('should return true when level meets minimum', async () => {
      const { shouldLog } = await import('../src/logForwarder.js');
      expect(shouldLog('error', 'info')).toBe(true);
      expect(shouldLog('warn', 'info')).toBe(true);
      expect(shouldLog('info', 'info')).toBe(true);
    });

    it('should return false when level is below minimum', async () => {
      const { shouldLog } = await import('../src/logForwarder.js');
      expect(shouldLog('debug', 'info')).toBe(false);
      expect(shouldLog('trace', 'info')).toBe(false);
      expect(shouldLog('debug', 'warn')).toBe(false);
    });

    it('should handle all log levels correctly', async () => {
      const { shouldLog } = await import('../src/logForwarder.js');
      expect(shouldLog('trace', 'trace')).toBe(true);
      expect(shouldLog('debug', 'debug')).toBe(true);
      expect(shouldLog('info', 'info')).toBe(true);
      expect(shouldLog('warn', 'warn')).toBe(true);
      expect(shouldLog('error', 'error')).toBe(true);
    });

    it('should respect log level hierarchy', async () => {
      const { shouldLog } = await import('../src/logForwarder.js');
      expect(shouldLog('error', 'trace')).toBe(true);
      expect(shouldLog('error', 'debug')).toBe(true);
      expect(shouldLog('error', 'info')).toBe(true);
      expect(shouldLog('error', 'warn')).toBe(true);
      expect(shouldLog('warn', 'trace')).toBe(true);
      expect(shouldLog('warn', 'debug')).toBe(true);
      expect(shouldLog('warn', 'info')).toBe(true);
    });
  });

  describe('forwardLog', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    afterEach(() => {
      vi.resetModules();
    });

    it('should not forward logs when below minimum level', async () => {
      const { forwardLog } = await import('../src/logForwarder.js');
      forwardLog('backend', 'debug', 'test message', 'info');
      expect(mockLoggerMethods.debug).not.toHaveBeenCalled();
    });

    it('should forward backend logs with correct prefix', async () => {
      const { forwardLog } = await import('../src/logForwarder.js');
      forwardLog('backend', 'info', 'test message', 'info');
      expect(mockLoggerMethods.info).toHaveBeenCalledWith('[Tauri:Backend] test message');
    });

    it('should forward frontend logs with correct prefix', async () => {
      const { forwardLog } = await import('../src/logForwarder.js');
      forwardLog('frontend', 'info', 'test message', 'info');
      expect(mockLoggerMethods.info).toHaveBeenCalledWith('[Tauri:Frontend] test message');
    });

    it('should include instance ID in prefix when provided', async () => {
      const { forwardLog } = await import('../src/logForwarder.js');
      forwardLog('backend', 'info', 'test message', 'info', undefined, 'browserA');
      expect(mockLoggerMethods.info).toHaveBeenCalledWith('[Tauri:Backend:browserA] test message');
    });

    it('should use warn level correctly', async () => {
      const { forwardLog } = await import('../src/logForwarder.js');
      forwardLog('backend', 'warn', 'warning message', 'info');
      expect(mockLoggerMethods.warn).toHaveBeenCalledWith('[Tauri:Backend] warning message');
    });

    it('should use error level correctly', async () => {
      const { forwardLog } = await import('../src/logForwarder.js');
      forwardLog('backend', 'error', 'error message', 'info');
      expect(mockLoggerMethods.error).toHaveBeenCalledWith('[Tauri:Backend] error message');
    });

    it('should use debug level when minimum is debug', async () => {
      const { forwardLog } = await import('../src/logForwarder.js');
      forwardLog('backend', 'debug', 'debug message', 'debug');
      expect(mockLoggerMethods.debug).toHaveBeenCalledWith('[Tauri:Backend] debug message');
    });

    it('should not add prefix if message already has one', async () => {
      const { forwardLog } = await import('../src/logForwarder.js');
      forwardLog('backend', 'info', '[Tauri:Backend] existing prefix', 'info');
      expect(mockLoggerMethods.info).toHaveBeenCalledWith('[Tauri:Backend] existing prefix');
    });

    it('should add instance ID to existing prefix', async () => {
      const { forwardLog } = await import('../src/logForwarder.js');
      forwardLog('backend', 'info', '[Tauri:Backend] existing prefix', 'info', undefined, 'worker-0');
      expect(mockLoggerMethods.info).toHaveBeenCalledWith('[Tauri:Backend:worker-0] existing prefix');
    });

    it('should use prefixedMessage when provided', async () => {
      const { forwardLog } = await import('../src/logForwarder.js');
      forwardLog('backend', 'info', 'ignored', 'info', '[Tauri:Backend] custom prefix message');
      expect(mockLoggerMethods.info).toHaveBeenCalledWith('[Tauri:Backend] custom prefix message');
    });

    it('should transform prefixedMessage with instance ID', async () => {
      const { forwardLog } = await import('../src/logForwarder.js');
      forwardLog('backend', 'info', 'ignored', 'info', '[Tauri:Backend] custom message', 'browserB');
      expect(mockLoggerMethods.info).toHaveBeenCalledWith('[Tauri:Backend:browserB] custom message');
    });
  });

  describe('file logging mode', () => {
    it('should use log writer when initialized', async () => {
      const { forwardLog } = await import('../src/logForwarder.js');
      const { isLogWriterInitialized, getLogWriter } = await import('@wdio/native-core');
      const mockWriter = { write: vi.fn() };

      vi.mocked(isLogWriterInitialized).mockReturnValue(true);
      vi.mocked(getLogWriter).mockReturnValue(mockWriter as never);

      forwardLog('backend', 'info', 'file message', 'info');

      expect(mockWriter.write).toHaveBeenCalledWith('[Tauri:Backend] file message');
    });
  });
});
