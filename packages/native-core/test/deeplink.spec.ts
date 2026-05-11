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
    it('accepts a well-formed custom protocol URL', () => {
      expect(validateDeeplinkUrl('myapp://open?file=test.txt')).toBe('myapp://open?file=test.txt');
    });

    it('accepts a URL with no path', () => {
      expect(validateDeeplinkUrl('myapp://')).toBe('myapp://');
    });

    it('rejects malformed URLs', () => {
      expect(() => validateDeeplinkUrl('not a url')).toThrow(/Invalid deeplink URL/);
      expect(() => validateDeeplinkUrl('')).toThrow(/Invalid deeplink URL/);
    });

    it('rejects http URLs', () => {
      expect(() => validateDeeplinkUrl('http://example.com')).toThrow(/Invalid deeplink protocol: http/);
    });

    it('rejects https URLs', () => {
      expect(() => validateDeeplinkUrl('https://example.com')).toThrow(/Invalid deeplink protocol: https/);
    });

    it('rejects file URLs', () => {
      expect(() => validateDeeplinkUrl('file:///tmp/test')).toThrow(/Invalid deeplink protocol: file/);
    });
  });

  describe('getPlatformCommand', () => {
    it('returns rundll32 invocation on Windows', () => {
      expect(getPlatformCommand('myapp://test', 'win32')).toEqual({
        command: 'rundll32.exe',
        args: ['url.dll,FileProtocolHandler', 'myapp://test'],
      });
    });

    it('returns open on macOS', () => {
      expect(getPlatformCommand('myapp://test', 'darwin')).toEqual({
        command: 'open',
        args: ['myapp://test'],
      });
    });

    it('returns gio open on Linux', () => {
      expect(getPlatformCommand('myapp://test', 'linux')).toEqual({
        command: 'gio',
        args: ['open', 'myapp://test'],
      });
    });

    it('throws on unsupported platforms', () => {
      expect(() => getPlatformCommand('myapp://test', 'aix')).toThrow(/Unsupported platform/);
    });
  });

  describe('executeDeeplinkCommand', () => {
    it('resolves after spawning', async () => {
      const { spawn } = await import('node:child_process');
      await executeDeeplinkCommand('open', ['myapp://test']);
      expect(spawn).toHaveBeenCalledWith('open', ['myapp://test'], expect.objectContaining({ detached: true }));
    });

    it('forwards a custom env to the spawned process', async () => {
      const { spawn } = await import('node:child_process');
      const env = { CUSTOM: 'value' };
      await executeDeeplinkCommand('open', ['myapp://test'], env);
      expect(spawn).toHaveBeenCalledWith('open', ['myapp://test'], expect.objectContaining({ env }));
    });
  });
});
