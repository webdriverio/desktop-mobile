import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { restoreAllMocks } from '../../src/commands/mock.js';
import mockStore from '../../src/mockStore.js';

vi.mock('../../src/mockStore.js', () => ({
  default: {
    getMocks: vi.fn(),
  },
}));

describe('restoreAllMocks Command', () => {
  let mockedGetPlatformInfo: any, mockedReadClipboard: any, mockedWriteClipboard: any;

  beforeEach(async () => {
    globalThis.browser = {
      execute: vi.fn().mockResolvedValue(undefined),
    } as unknown as WebdriverIO.Browser;

    mockedGetPlatformInfo = {
      getMockName: () => 'tauri.get_platform_info',
      mockRestore: vi.fn(),
    };
    mockedReadClipboard = {
      getMockName: () => 'tauri.read_clipboard',
      mockRestore: vi.fn(),
    };
    mockedWriteClipboard = {
      getMockName: () => 'tauri.write_clipboard',
      mockRestore: vi.fn(),
    };
    (mockStore.getMocks as Mock).mockReturnValue([
      ['tauri.get_platform_info', mockedGetPlatformInfo],
      ['tauri.read_clipboard', mockedReadClipboard],
      ['tauri.write_clipboard', mockedWriteClipboard],
    ]);
  });

  afterEach(() => {
    vi.resetAllMocks();
    delete (globalThis as any).browser;
  });

  it('should restore all mocks in the injection script when no prefix is provided', async () => {
    await restoreAllMocks();
    expect((globalThis.browser as any).execute).toHaveBeenCalledWith(expect.any(Function), '');

    const callback = (globalThis.browser as any).execute.mock.calls[0][0];
    const mockWindow = {
      __wdio_mocks__: {
        get_platform_info: { implementation: () => {} },
        read_clipboard: { implementation: () => {} },
      },
    } as any;
    (globalThis as any).window = mockWindow;
    try {
      callback(undefined);
      expect(mockWindow.__wdio_mocks__).toEqual({});
    } finally {
      delete (globalThis as any).window;
    }
  });

  it('should restore all outer mock functions when no prefix is provided', async () => {
    await restoreAllMocks();
    expect(mockedGetPlatformInfo.mockRestore).toHaveBeenCalled();
    expect(mockedReadClipboard.mockRestore).toHaveBeenCalled();
    expect(mockedWriteClipboard.mockRestore).toHaveBeenCalled();
  });

  it('should restore only mocks matching the command prefix', async () => {
    await restoreAllMocks('read');
    expect(mockedGetPlatformInfo.mockRestore).not.toHaveBeenCalled();
    expect(mockedReadClipboard.mockRestore).toHaveBeenCalled();
    expect(mockedWriteClipboard.mockRestore).not.toHaveBeenCalled();
  });

  it('should pass prefix to browser execute for inner mock filtering', async () => {
    await restoreAllMocks('write');
    expect((globalThis.browser as any).execute).toHaveBeenCalledWith(expect.any(Function), 'write');

    const callback = (globalThis.browser as any).execute.mock.calls[0][0];
    const mockWindow = {
      __wdio_mocks__: {
        get_platform_info: { implementation: () => {} },
        write_clipboard: { implementation: () => {} },
      },
    } as any;
    (globalThis as any).window = mockWindow;
    try {
      callback('write');
      expect(mockWindow.__wdio_mocks__.get_platform_info).toBeDefined();
      expect(mockWindow.__wdio_mocks__.write_clipboard).toBeUndefined();
    } finally {
      delete (globalThis as any).window;
    }
  });

  it('should handle prefix that matches no mocks', async () => {
    await restoreAllMocks('nonexistent');
    expect(mockedGetPlatformInfo.mockRestore).not.toHaveBeenCalled();
    expect(mockedReadClipboard.mockRestore).not.toHaveBeenCalled();
    expect(mockedWriteClipboard.mockRestore).not.toHaveBeenCalled();
  });

  it('should attempt every mock and then report the one whose mockRestore failed', async () => {
    mockedGetPlatformInfo.mockRestore.mockRejectedValue(new Error('inner mock gone'));

    await expect(restoreAllMocks()).rejects.toMatchObject({
      message: 'mockRestore failed: tauri.get_platform_info: inner mock gone',
    });

    expect(mockedReadClipboard.mockRestore).toHaveBeenCalled();
    expect(mockedWriteClipboard.mockRestore).toHaveBeenCalled();
  });

  it('should still run every mockRestore and report the failure when the in-app bulk call fails', async () => {
    (globalThis.browser as any).execute.mockRejectedValue(new Error('script error'));

    await expect(restoreAllMocks()).rejects.toMatchObject({
      message: 'mockRestore failed: all mocks (in-app): script error',
    });

    expect(mockedGetPlatformInfo.mockRestore).toHaveBeenCalled();
    expect(mockedReadClipboard.mockRestore).toHaveBeenCalled();
    expect(mockedWriteClipboard.mockRestore).toHaveBeenCalled();
  });

  it('should throw when no browser context is available', async () => {
    delete (globalThis as any).browser;
    await expect(restoreAllMocks.call({})).rejects.toThrow('restoreAllMocks requires a valid browser context');
  });

  it('should throw when browser is multiremote', async () => {
    const multiremoteBrowser = {
      isMultiremote: true,
      execute: vi.fn(),
    } as unknown as WebdriverIO.MultiRemoteBrowser;
    globalThis.browser = multiremoteBrowser as any;

    await expect(restoreAllMocks.call({})).rejects.toThrow('restoreAllMocks requires a valid browser context');
  });
});
