import { spawn } from 'node:child_process';
import { mockPlatform, restorePlatform } from '@repo/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  executeDeeplinkCommand,
  getPlatformCommand,
  triggerDeeplink,
  validateDeeplinkUrl,
} from '../../src/commands/triggerDeeplink.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('@wdio/native-utils', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('triggerDeeplink Command', () => {
  describe('validateDeeplinkUrl', () => {
    it('should accept valid custom protocol URLs', () => {
      expect(validateDeeplinkUrl('myapp://test')).toBe('myapp://test');
      expect(validateDeeplinkUrl('myapp://open?file=test.txt')).toBe('myapp://open?file=test.txt');
      expect(validateDeeplinkUrl('custom-proto://action?param=value')).toBe('custom-proto://action?param=value');
    });

    it('should reject http protocol', () => {
      expect(() => validateDeeplinkUrl('http://example.com')).toThrow(
        'Invalid deeplink protocol: http. Expected a custom protocol (e.g., myapp://).',
      );
    });

    it('should reject https protocol', () => {
      expect(() => validateDeeplinkUrl('https://example.com')).toThrow(
        'Invalid deeplink protocol: https. Expected a custom protocol (e.g., myapp://).',
      );
    });

    it('should reject file protocol', () => {
      expect(() => validateDeeplinkUrl('file:///path/to/file')).toThrow(
        'Invalid deeplink protocol: file. Expected a custom protocol (e.g., myapp://).',
      );
    });

    it('should reject malformed URLs', () => {
      expect(() => validateDeeplinkUrl('not a url')).toThrow('Invalid deeplink URL: not a url');
      expect(() => validateDeeplinkUrl('://')).toThrow('Invalid deeplink URL: ://');
      expect(() => validateDeeplinkUrl('')).toThrow('Invalid deeplink URL: ');
    });
  });

  describe('getPlatformCommand', () => {
    it('should generate Windows command', () => {
      const result = getPlatformCommand('myapp://test', 'win32');
      expect(result.command).toBe('rundll32.exe');
      expect(result.args).toEqual(['url.dll,FileProtocolHandler', 'myapp://test']);
    });

    it('should generate macOS command', () => {
      const result = getPlatformCommand('myapp://test', 'darwin');
      expect(result.command).toBe('open');
      expect(result.args).toEqual(['myapp://test']);
    });

    it('should generate Linux command', () => {
      const result = getPlatformCommand('myapp://test', 'linux');
      expect(result.command).toBe('gio');
      expect(result.args).toEqual(['open', 'myapp://test']);
    });

    it('should handle URLs with query parameters', () => {
      const result = getPlatformCommand('myapp://test?foo=bar&baz=qux', 'darwin');
      expect(result.args).toEqual(['myapp://test?foo=bar&baz=qux']);
    });

    it('should throw for unsupported platforms', () => {
      expect(() => getPlatformCommand('myapp://test', 'freebsd')).toThrow(
        'Unsupported platform for deeplink triggering: freebsd. Supported platforms are: win32, darwin, linux.',
      );
      expect(() => getPlatformCommand('myapp://test', 'unknown')).toThrow(
        'Unsupported platform for deeplink triggering: unknown. Supported platforms are: win32, darwin, linux.',
      );
    });
  });

  describe('executeDeeplinkCommand', () => {
    let mockChildProcess: {
      pid: number;
      unref: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      mockChildProcess = {
        pid: 12345,
        unref: vi.fn(),
        on: vi.fn(),
      };
      (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockChildProcess);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should spawn a detached process and resolve', async () => {
      await executeDeeplinkCommand('open', ['myapp://test']);

      expect(spawn).toHaveBeenCalledWith('open', ['myapp://test'], {
        detached: true,
        stdio: 'ignore',
        env: process.env,
      });
      expect(mockChildProcess.unref).toHaveBeenCalled();
    });

    it('should pass custom env when provided', async () => {
      const customEnv = { ...process.env, CUSTOM_VAR: 'value' };
      await executeDeeplinkCommand('open', ['myapp://test'], customEnv);

      expect(spawn).toHaveBeenCalledWith('open', ['myapp://test'], {
        detached: true,
        stdio: 'ignore',
        env: customEnv,
      });
    });

    it('should reject when spawn emits an error event', async () => {
      mockChildProcess.on.mockImplementation((event: string, handler: (err: Error) => void) => {
        if (event === 'error') {
          process.nextTick(() => handler(new Error('ENOENT')));
        }
      });

      await expect(executeDeeplinkCommand('nonexistent', ['myapp://test'])).rejects.toThrow(
        'Failed to trigger deeplink: ENOENT',
      );
    });

    it('should reject when spawn throws synchronously', async () => {
      (spawn as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('spawn EACCES');
      });

      await expect(executeDeeplinkCommand('open', ['myapp://test'])).rejects.toThrow(
        'Failed to trigger deeplink: spawn EACCES',
      );
    });
  });

  describe('triggerDeeplink', () => {
    const createBrowser = (execute = vi.fn().mockResolvedValue(undefined)) =>
      ({ execute }) as unknown as WebdriverIO.Browser;

    beforeEach(() => {
      vi.clearAllMocks();
      (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ pid: 99999, unref: vi.fn(), on: vi.fn() });
    });

    afterEach(() => {
      restorePlatform();
    });

    it.each([
      ['embedded', 'linux'],
      ['embedded', 'win32'],
      ['embedded', 'darwin'],
      ['crabnebula', 'darwin'],
    ] as const)('should emit the deep-link event in the app for %s on %s', async (provider, platform) => {
      mockPlatform(platform);
      const browser = createBrowser();
      await triggerDeeplink.call({ browser, provider }, 'myapp://test');

      expect(browser.execute).toHaveBeenCalledWith(expect.any(Function), 'myapp://test');
      expect(spawn).not.toHaveBeenCalled();
    });

    it.each([
      ['external', 'linux'],
      ['external', 'win32'],
      ['external', 'darwin'],
      ['crabnebula', 'linux'],
      ['crabnebula', 'win32'],
    ] as const)('should open the deeplink with the platform command for %s on %s', async (provider, platform) => {
      mockPlatform(platform);
      const browser = createBrowser();
      await triggerDeeplink.call({ browser, provider }, 'myapp://standard');

      expect(browser.execute).not.toHaveBeenCalled();
      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['myapp://standard']),
        expect.objectContaining({ detached: true, stdio: 'ignore' }),
      );
    });

    it('should throw when browser context is missing in embedded mode', async () => {
      await expect(triggerDeeplink.call({ provider: 'embedded' }, 'myapp://test')).rejects.toThrow(
        'embedded deeplink injection requires browser context',
      );
    });

    it('should throw when browser context is missing for CrabNebula on macOS', async () => {
      mockPlatform('darwin');
      await expect(triggerDeeplink.call({ provider: 'crabnebula' }, 'myapp://test')).rejects.toThrow(
        'crabnebula deeplink injection requires browser context',
      );
    });

    it('should throw when browser.execute fails in embedded mode', async () => {
      const browser = createBrowser(vi.fn().mockRejectedValue(new Error('session expired')));
      await expect(triggerDeeplink.call({ browser, provider: 'embedded' }, 'myapp://test')).rejects.toThrow(
        'Failed to inject deeplink: session expired',
      );
    });

    it('should validate the URL before triggering', async () => {
      await expect(triggerDeeplink.call({ provider: 'external' }, 'https://invalid.com')).rejects.toThrow(
        'Invalid deeplink protocol: https',
      );
    });

    it('should ask tauri-plugin-wdio to emit the deep-link event', async () => {
      const browser = createBrowser();
      await triggerDeeplink.call({ browser, provider: 'embedded' }, 'myapp://x');

      const [emitInApp, url] = vi.mocked(browser.execute).mock.calls[0] as unknown as [
        (url: string) => unknown,
        string,
      ];
      const invoke = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal('__TAURI_INTERNALS__', { invoke });
      try {
        await emitInApp(url);
      } finally {
        vi.unstubAllGlobals();
      }
      expect(invoke).toHaveBeenCalledWith('plugin:wdio|emit_deep_link', { url: 'myapp://x' });
    });

    it('should normalize the URL as the deep-link plugin does', async () => {
      const browser = createBrowser();
      await triggerDeeplink.call({ browser, provider: 'embedded' }, 'MyApp://Open?name=John Doe');

      expect(browser.execute).toHaveBeenCalledWith(expect.any(Function), 'myapp://Open?name=John%20Doe');
    });

    it('should say when the window has no Tauri IPC', async () => {
      const browser = createBrowser();
      await triggerDeeplink.call({ browser, provider: 'embedded' }, 'myapp://x');

      const [emitInApp, url] = vi.mocked(browser.execute).mock.calls[0] as unknown as [
        (url: string) => unknown,
        string,
      ];
      expect(() => emitInApp(url)).toThrow('Tauri IPC (__TAURI_INTERNALS__) is not available in this window');
    });
  });
});
