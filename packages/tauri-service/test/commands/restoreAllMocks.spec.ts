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

  it('should call mockRestore on every mock, with no bulk in-app call, when no prefix is provided', async () => {
    await restoreAllMocks();
    expect(mockedGetPlatformInfo.mockRestore).toHaveBeenCalled();
    expect(mockedReadClipboard.mockRestore).toHaveBeenCalled();
    expect(mockedWriteClipboard.mockRestore).toHaveBeenCalled();
    expect((globalThis.browser as any).execute).not.toHaveBeenCalled();
  });

  it('should restore only mocks matching the command prefix', async () => {
    await restoreAllMocks('read');
    expect(mockedGetPlatformInfo.mockRestore).not.toHaveBeenCalled();
    expect(mockedReadClipboard.mockRestore).toHaveBeenCalled();
    expect(mockedWriteClipboard.mockRestore).not.toHaveBeenCalled();
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

  it('should restore every mock without a browser context', async () => {
    delete (globalThis as any).browser;
    await restoreAllMocks.call({});
    expect(mockedGetPlatformInfo.mockRestore).toHaveBeenCalled();
    expect(mockedReadClipboard.mockRestore).toHaveBeenCalled();
    expect(mockedWriteClipboard.mockRestore).toHaveBeenCalled();
  });

  it('should restore every mock when called on the multiremote browser', async () => {
    const multiremoteBrowser = {
      isMultiremote: true,
      execute: vi.fn(),
    } as unknown as WebdriverIO.MultiRemoteBrowser;

    await restoreAllMocks.call({ browser: multiremoteBrowser });

    expect(mockedGetPlatformInfo.mockRestore).toHaveBeenCalled();
    expect(mockedReadClipboard.mockRestore).toHaveBeenCalled();
    expect(mockedWriteClipboard.mockRestore).toHaveBeenCalled();
  });
});
