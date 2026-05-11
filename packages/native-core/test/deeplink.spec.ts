import { describe, expect, it, vi } from 'vitest';

import { executeDeeplinkCommand, getPlatformCommand, validateDeeplinkUrl } from '../src/deeplink.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({
    pid: 12345,
    unref: vi.fn(),
    on: vi.fn(),
  })),
}));

describe('deeplink', () => {
  describe('validateDeeplinkUrl', () => {
    it('should accept a well-formed custom protocol URL', () => {
      expect(validateDeeplinkUrl('myapp://open?file=test.txt')).toBe('myapp://open?file=test.txt');
    });

    it('should accept a URL with no path', () => {
      expect(validateDeeplinkUrl('myapp://')).toBe('myapp://');
    });

    it('should reject malformed URLs', () => {
      expect(() => validateDeeplinkUrl('not a url')).toThrow(/Invalid deeplink URL/);
      expect(() => validateDeeplinkUrl('')).toThrow(/Invalid deeplink URL/);
    });

    it('should reject http URLs', () => {
      expect(() => validateDeeplinkUrl('http://example.com')).toThrow(/Invalid deeplink protocol: http/);
    });

    it('should reject https URLs', () => {
      expect(() => validateDeeplinkUrl('https://example.com')).toThrow(/Invalid deeplink protocol: https/);
    });

    it('should reject file URLs', () => {
      expect(() => validateDeeplinkUrl('file:///tmp/test')).toThrow(/Invalid deeplink protocol: file/);
    });
  });

  describe('getPlatformCommand', () => {
    it('should return rundll32 invocation on Windows', () => {
      expect(getPlatformCommand('myapp://test', 'win32')).toEqual({
        command: 'rundll32.exe',
        args: ['url.dll,FileProtocolHandler', 'myapp://test'],
      });
    });

    it('should return open on macOS', () => {
      expect(getPlatformCommand('myapp://test', 'darwin')).toEqual({
        command: 'open',
        args: ['myapp://test'],
      });
    });

    it('should return gio open on Linux', () => {
      expect(getPlatformCommand('myapp://test', 'linux')).toEqual({
        command: 'gio',
        args: ['open', 'myapp://test'],
      });
    });

    it('should throw on unsupported platforms', () => {
      expect(() => getPlatformCommand('myapp://test', 'aix')).toThrow(/Unsupported platform/);
    });
  });

  describe('executeDeeplinkCommand', () => {
    it('should resolve after spawning', async () => {
      const { spawn } = await import('node:child_process');
      await executeDeeplinkCommand('open', ['myapp://test']);
      expect(spawn).toHaveBeenCalledWith('open', ['myapp://test'], expect.objectContaining({ detached: true }));
    });

    it('should forward a custom env to the spawned process', async () => {
      const { spawn } = await import('node:child_process');
      const env = { CUSTOM: 'value' };
      await executeDeeplinkCommand('open', ['myapp://test'], env);
      expect(spawn).toHaveBeenCalledWith('open', ['myapp://test'], expect.objectContaining({ env }));
    });
  });
});
