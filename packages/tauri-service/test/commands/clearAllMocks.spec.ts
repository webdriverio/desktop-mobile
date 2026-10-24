import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { clearAllMocks } from '../../src/commands/mock.js';
import mockStore from '../../src/mockStore.js';

vi.mock('../../src/mockStore.js', () => ({
  default: {
    getMocks: vi.fn(),
  },
}));

describe('clearAllMocks Command', () => {
  let mockedGetPlatformInfo: any, mockedReadClipboard: any, mockedWriteClipboard: any;

  beforeEach(async () => {
    mockedGetPlatformInfo = {
      getMockName: () => 'tauri.get_platform_info',
      mockClear: vi.fn(),
    };
    mockedReadClipboard = {
      getMockName: () => 'tauri.read_clipboard',
      mockClear: vi.fn(),
    };
    mockedWriteClipboard = {
      getMockName: () => 'tauri.write_clipboard',
      mockClear: vi.fn(),
    };
    (mockStore.getMocks as Mock).mockReturnValue([
      ['tauri.get_platform_info', mockedGetPlatformInfo],
      ['tauri.read_clipboard', mockedReadClipboard],
      ['tauri.write_clipboard', mockedWriteClipboard],
    ]);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('should clear all mock functions when no prefix is provided', async () => {
    await clearAllMocks();
    expect(mockedGetPlatformInfo.mockClear).toHaveBeenCalled();
    expect(mockedReadClipboard.mockClear).toHaveBeenCalled();
    expect(mockedWriteClipboard.mockClear).toHaveBeenCalled();
  });

  it('should clear only mocks matching the command prefix', async () => {
    await clearAllMocks('read');
    expect(mockedGetPlatformInfo.mockClear).not.toHaveBeenCalled();
    expect(mockedReadClipboard.mockClear).toHaveBeenCalled();
    expect(mockedWriteClipboard.mockClear).not.toHaveBeenCalled();
  });

  it('should clear multiple mocks matching the prefix', async () => {
    await clearAllMocks('write');
    expect(mockedGetPlatformInfo.mockClear).not.toHaveBeenCalled();
    expect(mockedReadClipboard.mockClear).not.toHaveBeenCalled();
    expect(mockedWriteClipboard.mockClear).toHaveBeenCalled();
  });

  it('should handle prefix that matches no mocks', async () => {
    await clearAllMocks('nonexistent');
    expect(mockedGetPlatformInfo.mockClear).not.toHaveBeenCalled();
    expect(mockedReadClipboard.mockClear).not.toHaveBeenCalled();
    expect(mockedWriteClipboard.mockClear).not.toHaveBeenCalled();
  });

  it('should attempt every mock and then report the one whose mockClear failed', async () => {
    mockedGetPlatformInfo.mockClear.mockRejectedValue(new Error('inner mock gone'));

    await expect(clearAllMocks()).rejects.toMatchObject({
      message: 'mockClear failed: tauri.get_platform_info: inner mock gone',
    });

    expect(mockedReadClipboard.mockClear).toHaveBeenCalled();
    expect(mockedWriteClipboard.mockClear).toHaveBeenCalled();
  });

  it('should escape regex metacharacters in prefix so dot is literal', async () => {
    const mockedDotCommand = {
      getMockName: () => 'tauri.get_platform.info',
      mockClear: vi.fn(),
    };
    const mockedNonDotCommand = {
      getMockName: () => 'tauri.get_platformXinfo',
      mockClear: vi.fn(),
    };
    (mockStore.getMocks as Mock).mockReturnValue([
      ['tauri.get_platform.info', mockedDotCommand],
      ['tauri.get_platformXinfo', mockedNonDotCommand],
    ]);

    await clearAllMocks('get_platform.info');
    expect(mockedDotCommand.mockClear).toHaveBeenCalled();
    expect(mockedNonDotCommand.mockClear).not.toHaveBeenCalled();
  });
});
