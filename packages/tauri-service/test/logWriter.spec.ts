import { createWriteStream, existsSync, mkdirSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  createWriteStream: vi.fn(() => ({
    write: vi.fn(),
    end: vi.fn(),
  })),
}));

vi.mock('@wdio/native-utils', () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('logWriter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the singleton
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('LogWriter', () => {
    it('should initialize and create log directory', async () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const { getLogWriter } = await import('../src/logWriter.js');
      const writer = getLogWriter();
      writer.initialize('/tmp/test-logs');

      expect(mkdirSync).toHaveBeenCalledWith('/tmp/test-logs', { recursive: true });
      expect(createWriteStream).toHaveBeenCalled();
    });

    it('should not create directory if it exists', async () => {
      vi.mocked(existsSync).mockReturnValue(true);

      const { getLogWriter } = await import('../src/logWriter.js');
      const writer = getLogWriter();
      writer.initialize('/tmp/existing-logs');

      expect(mkdirSync).not.toHaveBeenCalled();
    });

    it('should write message to console when not initialized', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const { getLogWriter } = await import('../src/logWriter.js');
      const writer = getLogWriter();
      writer.write('test message');

      expect(consoleSpy).toHaveBeenCalledWith('test message');
      consoleSpy.mockRestore();
    });

    it('should write message to stream when initialized', async () => {
      const mockStream = {
        write: vi.fn(),
        end: vi.fn(),
      };
      vi.mocked(createWriteStream).mockReturnValue(mockStream as unknown as WriteStream);
      vi.mocked(existsSync).mockReturnValue(true);

      const { getLogWriter } = await import('../src/logWriter.js');
      const writer = getLogWriter();
      writer.initialize('/tmp/logs');
      writer.write('test message');

      expect(mockStream.write).toHaveBeenCalled();
      const writtenMessage = mockStream.write.mock.calls[0][0];
      expect(writtenMessage).toContain('test message');
    });

    it('should use prefixedMessage when provided', async () => {
      const mockStream = {
        write: vi.fn(),
        end: vi.fn(),
      };
      vi.mocked(createWriteStream).mockReturnValue(mockStream as unknown as WriteStream);
      vi.mocked(existsSync).mockReturnValue(true);

      const { getLogWriter } = await import('../src/logWriter.js');
      const writer = getLogWriter();
      writer.initialize('/tmp/logs');
      writer.write('regular message', '[Tauri:Backend] prefixed message');

      const writtenMessage = mockStream.write.mock.calls[0][0];
      expect(writtenMessage).toContain('[Tauri:Backend] prefixed message');
      expect(writtenMessage).not.toContain('regular message');
    });

    it('should close stream on close()', async () => {
      const mockStream = {
        write: vi.fn(),
        end: vi.fn((cb?: () => void) => cb?.()),
      };
      vi.mocked(createWriteStream).mockReturnValue(mockStream as unknown as WriteStream);
      vi.mocked(existsSync).mockReturnValue(true);

      const { getLogWriter } = await import('../src/logWriter.js');
      const writer = getLogWriter();
      writer.initialize('/tmp/logs');
      await writer.close();

      expect(mockStream.end).toHaveBeenCalled();
    });

    it('should return log directory', async () => {
      vi.mocked(existsSync).mockReturnValue(true);

      const { getLogWriter } = await import('../src/logWriter.js');
      const writer = getLogWriter();
      writer.initialize('/tmp/my-logs');

      expect(writer.getLogDir()).toBe('/tmp/my-logs');
    });

    it('should return log file path', async () => {
      vi.mocked(existsSync).mockReturnValue(true);

      const { getLogWriter } = await import('../src/logWriter.js');
      const writer = getLogWriter();
      const testLogDir = join(process.cwd(), 'test-logs');
      writer.initialize(testLogDir);

      expect(writer.getLogFile()).toBeDefined();
      expect(writer.getLogFile()).toContain(testLogDir);
      expect(writer.getLogFile()).toContain('wdio-');
      expect(writer.getLogFile()).toContain('.log');
    });
  });

  describe('singleton functions', () => {
    it('should return same instance from getLogWriter', async () => {
      const { getLogWriter } = await import('../src/logWriter.js');
      const writer1 = getLogWriter();
      const writer2 = getLogWriter();

      expect(writer1).toBe(writer2);
    });

    it('should report not initialized before initialize()', async () => {
      const { isLogWriterInitialized } = await import('../src/logWriter.js');

      expect(isLogWriterInitialized()).toBe(false);
    });

    it('should report initialized after initialize()', async () => {
      vi.mocked(existsSync).mockReturnValue(true);

      const { getLogWriter, isLogWriterInitialized } = await import('../src/logWriter.js');
      const writer = getLogWriter();
      const testLogDir = join(process.cwd(), 'test-logs');
      writer.initialize(testLogDir);

      expect(isLogWriterInitialized()).toBe(true);
    });

    it('should close writer and reset singleton', async () => {
      const mockStream = {
        write: vi.fn(),
        end: vi.fn((cb?: () => void) => cb?.()),
      };
      vi.mocked(createWriteStream).mockReturnValue(mockStream as unknown as WriteStream);
      vi.mocked(existsSync).mockReturnValue(true);

      const { getLogWriter, closeLogWriter, isLogWriterInitialized } = await import('../src/logWriter.js');
      const writer = getLogWriter();
      const testLogDir = join(process.cwd(), 'test-logs');
      writer.initialize(testLogDir);

      expect(isLogWriterInitialized()).toBe(true);

      await closeLogWriter();

      expect(isLogWriterInitialized()).toBe(false);
      expect(mockStream.end).toHaveBeenCalled();
    });
  });
});
