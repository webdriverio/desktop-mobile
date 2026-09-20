import { mockPlatform, restorePlatform } from '@repo/test-utils';
import type { ElectronServiceGlobalOptions } from '@wdio/native-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoist mock creation before all imports
const { mockSpawn } = vi.hoisted(() => {
  return {
    mockSpawn: vi.fn(),
  };
});

// Mock child_process before importing
vi.mock('node:child_process', () => ({
  default: {
    spawn: mockSpawn,
  },
  spawn: mockSpawn,
}));

// Mock logger
vi.mock('@wdio/native-utils', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    trace: vi.fn(),
  }),
}));

// Import after mocks are set up
import {
  appendUserDataDir,
  executeDeeplinkCommand,
  getPlatformCommand,
  triggerDeeplink,
  validateDeeplinkUrl,
} from '../../src/commands/triggerDeeplink.js';

describe('validateDeeplinkUrl', () => {
  it('should accept valid custom protocol URLs', () => {
    expect(validateDeeplinkUrl('myapp://test')).toBe('myapp://test');
    expect(validateDeeplinkUrl('custom://action?param=value')).toBe('custom://action?param=value');
    expect(validateDeeplinkUrl('app123://deep/path')).toBe('app123://deep/path');
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

  it('should handle URLs with complex query strings', () => {
    const url = 'myapp://test?foo=bar&array[]=a&array[]=b&nested[key]=value';
    expect(validateDeeplinkUrl(url)).toBe(url);
  });

  it('should handle URLs with fragments', () => {
    const url = 'myapp://test#fragment';
    expect(validateDeeplinkUrl(url)).toBe(url);
  });

  it('should handle URLs with both query and fragment', () => {
    const url = 'myapp://test?foo=bar#fragment';
    expect(validateDeeplinkUrl(url)).toBe(url);
  });
});

describe('appendUserDataDir', () => {
  it('should append userData parameter to URL without query string', () => {
    const result = appendUserDataDir('myapp://test', '/tmp/user-data');
    expect(result).toBe('myapp://test?userData=%2Ftmp%2Fuser-data');
  });

  it('should append userData parameter to URL with existing query string', () => {
    const result = appendUserDataDir('myapp://test?foo=bar', '/tmp/user-data');
    expect(result).toBe('myapp://test?foo=bar&userData=%2Ftmp%2Fuser-data');
  });

  it('should preserve existing query parameters', () => {
    const result = appendUserDataDir('myapp://test?param1=value1&param2=value2', '/custom/path');
    const url = new URL(result);
    expect(url.searchParams.get('param1')).toBe('value1');
    expect(url.searchParams.get('param2')).toBe('value2');
    expect(url.searchParams.get('userData')).toBe('/custom/path');
  });

  it('should overwrite existing userData parameter', () => {
    const result = appendUserDataDir('myapp://test?userData=/old/path', '/new/path');
    expect(result).toBe('myapp://test?userData=%2Fnew%2Fpath');
  });

  it('should handle URLs with fragments', () => {
    const result = appendUserDataDir('myapp://test#fragment', '/tmp/user-data');
    const url = new URL(result);
    expect(url.searchParams.get('userData')).toBe('/tmp/user-data');
    expect(url.hash).toBe('#fragment');
  });

  it('should handle complex query parameters (arrays)', () => {
    const result = appendUserDataDir('myapp://test?array[]=a&array[]=b', '/tmp/user-data');
    const url = new URL(result);
    expect(url.searchParams.get('array[]')).toBe('a'); // First value
    expect(url.searchParams.get('userData')).toBe('/tmp/user-data');
  });

  it('should handle Windows paths with backslashes', () => {
    const result = appendUserDataDir('myapp://test', 'C:\\Users\\Test\\AppData');
    const url = new URL(result);
    expect(url.searchParams.get('userData')).toBe('C:\\Users\\Test\\AppData');
  });
});

describe('getPlatformCommand', () => {
  describe('Windows (win32)', () => {
    it('should return correct command for Windows', () => {
      const result = getPlatformCommand('myapp://test', 'win32', 'C:\\app.exe');
      expect(result).toEqual({
        command: 'rundll32.exe',
        args: ['url.dll,FileProtocolHandler', 'myapp://test'],
      });
    });

    it('should throw error if appBinaryPath is missing', () => {
      expect(() => getPlatformCommand('myapp://test', 'win32')).toThrow(
        'triggerDeeplink requires appBinaryPath to be configured on Windows. ' +
          'Please set appBinaryPath in your wdio:electronServiceOptions.',
      );
    });

    it('should throw error if appBinaryPath is undefined', () => {
      expect(() => getPlatformCommand('myapp://test', 'win32', undefined)).toThrow(
        'triggerDeeplink requires appBinaryPath to be configured on Windows.',
      );
    });

    it('should handle URLs with query parameters', () => {
      const result = getPlatformCommand('myapp://test?foo=bar&userData=/tmp/data', 'win32', 'C:\\app.exe');
      expect(result.args).toContain('myapp://test?foo=bar&userData=/tmp/data');
    });
  });

  describe('macOS (darwin)', () => {
    it('should return correct command for macOS', () => {
      const result = getPlatformCommand('myapp://test', 'darwin');
      expect(result).toEqual({
        command: 'open',
        args: ['myapp://test'],
      });
    });

    it('should not require appBinaryPath for macOS', () => {
      const result = getPlatformCommand('myapp://test', 'darwin', undefined);
      expect(result.command).toBe('open');
    });

    it('should handle URLs with query parameters', () => {
      const result = getPlatformCommand('myapp://test?foo=bar', 'darwin');
      expect(result.args).toEqual(['myapp://test?foo=bar']);
    });
  });

  describe('Linux', () => {
    it('should return correct command for Linux', () => {
      const result = getPlatformCommand('myapp://test', 'linux');
      expect(result).toEqual({
        command: 'gio',
        args: ['open', 'myapp://test'],
      });
    });

    it('should not require appBinaryPath for Linux', () => {
      const result = getPlatformCommand('myapp://test', 'linux', undefined);
      expect(result.command).toBe('gio');
    });

    it('should handle URLs with query parameters', () => {
      const result = getPlatformCommand('myapp://test?foo=bar', 'linux');
      expect(result.args).toEqual(['open', 'myapp://test?foo=bar']);
    });
  });

  describe('Unsupported platforms', () => {
    it('should throw error for unsupported platform', () => {
      expect(() => getPlatformCommand('myapp://test', 'freebsd')).toThrow(
        'Unsupported platform for deeplink triggering: freebsd. ' + 'Supported platforms are: win32, darwin, linux.',
      );
    });

    it('should throw error for unknown platform', () => {
      expect(() => getPlatformCommand('myapp://test', 'unknown')).toThrow(
        'Unsupported platform for deeplink triggering: unknown.',
      );
    });
  });
});

describe('executeDeeplinkCommand', () => {
  let mockChildProcess: any;

  beforeEach(() => {
    mockSpawn.mockClear();
    mockChildProcess = {
      on: vi.fn(),
      unref: vi.fn(),
    };
    mockSpawn.mockReturnValue(mockChildProcess as any);
  });

  it('should spawn command with correct parameters', async () => {
    await executeDeeplinkCommand('open', ['myapp://test']);

    expect(mockSpawn).toHaveBeenCalledWith(
      'open',
      ['myapp://test'],
      expect.objectContaining({
        detached: true,
        stdio: 'ignore',
      }),
    );
  });

  it('should unref the child process', async () => {
    await executeDeeplinkCommand('open', ['myapp://test']);
    expect(mockChildProcess.unref).toHaveBeenCalled();
  });

  it('should not use shell option', async () => {
    await executeDeeplinkCommand('rundll32.exe', ['url.dll,FileProtocolHandler', 'myapp://test']);

    const spawnOptions = mockSpawn.mock.calls[0][2];
    expect(spawnOptions.shell).toBeUndefined();
  });

  it('should resolve promise on successful spawn', async () => {
    await expect(executeDeeplinkCommand('open', ['myapp://test'])).resolves.toBeUndefined();
  });

  it('should reject promise on spawn error', async () => {
    mockChildProcess.on.mockImplementation((event: string, callback: (error: Error) => void) => {
      if (event === 'error') {
        process.nextTick(() => callback(new Error('ENOENT')));
      }
    });

    await expect(executeDeeplinkCommand('invalid-command', ['myapp://test'])).rejects.toThrow(
      'Failed to trigger deeplink: ENOENT',
    );
  });

  it('should handle spawn exceptions', async () => {
    mockSpawn.mockImplementation(() => {
      throw new Error('Spawn failed');
    });

    await expect(executeDeeplinkCommand('open', ['myapp://test'])).rejects.toThrow(
      'Failed to trigger deeplink: Spawn failed',
    );

    // Restore default mock implementation
    mockSpawn.mockReturnValue(mockChildProcess as any);
  });

  it('should handle multiple args correctly', async () => {
    await executeDeeplinkCommand('rundll32.exe', ['url.dll,FileProtocolHandler', 'myapp://test']);

    expect(mockSpawn).toHaveBeenCalledWith(
      'rundll32.exe',
      ['url.dll,FileProtocolHandler', 'myapp://test'],
      expect.any(Object),
    );
  });
});

describe('triggerDeeplink', () => {
  let mockContext: {
    browser?: WebdriverIO.Browser;
    globalOptions: ElectronServiceGlobalOptions;
    userDataDir?: string;
  };
  let mockChildProcess: any;

  beforeEach(() => {
    mockSpawn.mockClear();
    mockContext = {
      globalOptions: {},
      userDataDir: undefined,
    };

    // Setup spawn mock for each test
    mockChildProcess = {
      on: vi.fn(),
      unref: vi.fn(),
    };
    mockSpawn.mockReturnValue(mockChildProcess as any);
  });

  describe('URL validation', () => {
    it('should validate URL before processing', async () => {
      mockContext.globalOptions = { appBinaryPath: 'C:\\app.exe' };

      await expect(triggerDeeplink.call(mockContext, 'https://example.com')).rejects.toThrow(
        'Invalid deeplink protocol: https',
      );
    });

    it('should reject malformed URLs', async () => {
      mockContext.globalOptions = { appBinaryPath: 'C:\\app.exe' };

      await expect(triggerDeeplink.call(mockContext, 'not a url')).rejects.toThrow('Invalid deeplink URL');
    });
  });

  describe('Windows platform behavior', () => {
    beforeEach(() => {
      mockSpawn.mockClear();
      mockPlatform('win32');
    });

    afterEach(() => {
      restorePlatform();
    });

    it('should throw error if appBinaryPath is missing on Windows', async () => {
      mockContext.globalOptions = {};

      await expect(triggerDeeplink.call(mockContext, 'myapp://test')).rejects.toThrow(
        'triggerDeeplink requires appBinaryPath to be configured on Windows',
      );
    });

    it('should append userData to URL on Windows when userDataDir is set', async () => {
      mockContext.globalOptions = { appBinaryPath: 'C:\\app.exe' };
      mockContext.userDataDir = 'C:\\Users\\Test\\AppData';

      await triggerDeeplink.call(mockContext, 'myapp://test');

      // Verify that spawn was called with a URL containing userData
      const spawnCall = mockSpawn.mock.calls[0];
      const urlArg = spawnCall[1][1]; // The URL is the 2nd argument in ['url.dll,FileProtocolHandler', url]
      expect(urlArg).toContain('userData=');
    });

    it('should not append userData on Windows when userDataDir is missing', async () => {
      mockContext.globalOptions = { appBinaryPath: 'C:\\app.exe' };
      mockContext.userDataDir = undefined;

      await triggerDeeplink.call(mockContext, 'myapp://test');

      // Verify that spawn was called with the original URL
      const spawnCall = mockSpawn.mock.calls[0];
      const urlArg = spawnCall[1][1];
      expect(urlArg).toBe('myapp://test');
    });
  });

  describe('macOS platform behavior', () => {
    beforeEach(() => {
      mockSpawn.mockClear();
      mockPlatform('darwin');
    });

    afterEach(() => {
      restorePlatform();
    });

    it('should not require appBinaryPath on macOS', async () => {
      mockContext.globalOptions = {};

      await expect(triggerDeeplink.call(mockContext, 'myapp://test')).resolves.toBeUndefined();
    });

    it('should not append userData on macOS', async () => {
      mockContext.globalOptions = {};
      mockContext.userDataDir = '/tmp/user-data';

      await triggerDeeplink.call(mockContext, 'myapp://test');

      // Verify that spawn was called with the original URL
      const spawnCall = mockSpawn.mock.calls[0];
      expect(spawnCall[1][0]).toBe('myapp://test');
      expect(spawnCall[1][0]).not.toContain('userData=');
    });
  });

  describe('Linux platform behavior', () => {
    beforeEach(() => {
      mockSpawn.mockClear();
      mockPlatform('linux');
    });

    afterEach(() => {
      restorePlatform();
    });

    it('should not require appBinaryPath on Linux', async () => {
      mockContext.globalOptions = {};

      await expect(triggerDeeplink.call(mockContext, 'myapp://test')).resolves.toBeUndefined();
    });

    it('should append userData on Linux', async () => {
      mockContext.globalOptions = {};
      mockContext.userDataDir = '/tmp/user-data';

      await triggerDeeplink.call(mockContext, 'myapp://test');

      // Verify that spawn was called with userData appended
      const spawnCall = mockSpawn.mock.calls[0];
      expect(spawnCall[1][1]).toContain('userData=');
      expect(spawnCall[1][1]).toContain(encodeURIComponent('/tmp/user-data'));
    });
  });

  describe('userData auto-detection', () => {
    beforeEach(() => {
      mockPlatform('win32');
    });

    afterEach(() => {
      restorePlatform();
    });

    it('should auto-detect userDataDir from the running app when not already set', async () => {
      mockContext.globalOptions = { appBinaryPath: 'C:\\app.exe' };
      mockContext.userDataDir = undefined;
      mockContext.browser = {
        electron: {
          execute: vi.fn().mockResolvedValue('C:\\Users\\Test\\AppData\\Roaming\\myapp'),
        },
      } as unknown as WebdriverIO.Browser;

      await triggerDeeplink.call(mockContext, 'myapp://test');

      expect(mockContext.browser.electron.execute).toHaveBeenCalledWith(expect.any(Function));
      expect(mockContext.userDataDir).toBe('C:\\Users\\Test\\AppData\\Roaming\\myapp');
      // Verify userData was appended to the URL
      const spawnCall = mockSpawn.mock.calls[0];
      const urlArg = spawnCall[1][1];
      expect(urlArg).toContain('userData=');
    });

    it('should cache userDataDir after first auto-detection', async () => {
      mockContext.globalOptions = { appBinaryPath: 'C:\\app.exe' };
      mockContext.userDataDir = undefined;
      mockContext.browser = {
        electron: {
          execute: vi.fn().mockResolvedValue('C:\\Users\\Test\\AppData'),
        },
      } as unknown as WebdriverIO.Browser;

      await triggerDeeplink.call(mockContext, 'myapp://test');
      expect(mockContext.userDataDir).toBe('C:\\Users\\Test\\AppData');

      // Second call should use cached value
      mockSpawn.mockClear();
      await triggerDeeplink.call(mockContext, 'myapp://test2');
      expect(mockContext.browser.electron.execute).toHaveBeenCalledTimes(1); // Only called once
    });

    it('should skip auto-detection if userDataDir is already set', async () => {
      mockContext.globalOptions = { appBinaryPath: 'C:\\app.exe' };
      mockContext.userDataDir = 'C:\\existing\\path';
      mockContext.browser = {
        electron: {
          execute: vi.fn(),
        },
      } as unknown as WebdriverIO.Browser;

      await triggerDeeplink.call(mockContext, 'myapp://test');
      expect(mockContext.browser.electron.execute).not.toHaveBeenCalled();
    });

    it('should handle auto-detection failure gracefully', async () => {
      mockContext.globalOptions = { appBinaryPath: 'C:\\app.exe' };
      mockContext.userDataDir = undefined;
      mockContext.browser = {
        electron: {
          execute: vi.fn().mockRejectedValue(new Error('CDP bridge not available')),
        },
      } as unknown as WebdriverIO.Browser;

      // Should not throw despite auto-detection failure
      await triggerDeeplink.call(mockContext, 'myapp://test');

      // userData should not be set
      expect(mockContext.userDataDir).toBeUndefined();
      // URL should not contain userData param
      const spawnCall = mockSpawn.mock.calls[0];
      const urlArg = spawnCall[1][1];
      expect(urlArg).toBe('myapp://test');
    });
  });

  describe('Error handling', () => {
    beforeEach(() => {
      mockPlatform('darwin');
    });

    afterEach(() => {
      restorePlatform();
    });

    it('should propagate errors from executeDeeplinkCommand', async () => {
      mockContext.globalOptions = {};

      // Mock spawn to throw error
      mockChildProcess.on.mockImplementation((event: string, callback: (error: Error) => void) => {
        if (event === 'error') {
          process.nextTick(() => callback(new Error('Command failed')));
        }
      });

      await expect(triggerDeeplink.call(mockContext, 'myapp://test')).rejects.toThrow(
        'Failed to trigger deeplink: Command failed',
      );
    });
  });

  describe('Integration tests', () => {
    afterEach(() => {
      restorePlatform();
    });

    it('should handle complete Windows flow with all options', async () => {
      mockPlatform('win32');

      mockContext.globalOptions = { appBinaryPath: 'C:\\app.exe' };
      mockContext.userDataDir = 'C:\\Users\\Test\\AppData';

      await triggerDeeplink.call(mockContext, 'myapp://test?foo=bar');

      expect(mockSpawn).toHaveBeenCalledWith(
        'rundll32.exe',
        expect.arrayContaining(['url.dll,FileProtocolHandler']),
        expect.objectContaining({
          detached: true,
          stdio: 'ignore',
        }),
      );

      // Verify URL includes both original params and userData
      const spawnCall = mockSpawn.mock.calls[0];
      const urlArg = spawnCall[1][1]; // The URL is the 2nd argument
      expect(urlArg).toContain('foo=bar');
      expect(urlArg).toContain('userData=');
    });

    it('should handle complete macOS flow', async () => {
      mockPlatform('darwin');

      mockContext.globalOptions = {};

      await triggerDeeplink.call(mockContext, 'myapp://test?foo=bar');

      expect(mockSpawn).toHaveBeenCalledWith(
        'open',
        ['myapp://test?foo=bar'],
        expect.objectContaining({
          detached: true,
          stdio: 'ignore',
        }),
      );
    });

    it('should handle complete Linux flow', async () => {
      mockPlatform('linux');

      mockContext.globalOptions = {};

      await triggerDeeplink.call(mockContext, 'myapp://test?foo=bar');

      expect(mockSpawn).toHaveBeenCalledWith(
        'gio',
        ['open', 'myapp://test?foo=bar'],
        expect.objectContaining({
          detached: true,
          stdio: 'ignore',
        }),
      );
    });

    it('should preserve complex URL parameters', async () => {
      mockPlatform('darwin');

      mockContext.globalOptions = {};

      const complexUrl = 'myapp://action?array[]=a&array[]=b&nested[key]=value#fragment';
      await triggerDeeplink.call(mockContext, complexUrl);

      const spawnCall = mockSpawn.mock.calls[0];
      expect(spawnCall[1][0]).toBe(complexUrl);
    });
  });
});
