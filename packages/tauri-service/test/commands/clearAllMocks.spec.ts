import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearAllMocks } from '../../src/commands/mock.js';
import mockStore from '../../src/mockStore.js';
import { createFakeMultiremote } from './multiremoteFakes.js';

describe('clearAllMocks Command', () => {
  let mockedGetPlatformInfo: any, mockedReadClipboard: any, mockedWriteClipboard: any;

  beforeEach(async () => {
    globalThis.browser = { execute: vi.fn().mockResolvedValue(undefined) } as unknown as WebdriverIO.Browser;

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
    mockStore.setMock(globalThis.browser, mockedGetPlatformInfo);
    mockStore.setMock(globalThis.browser, mockedReadClipboard);
    mockStore.setMock(globalThis.browser, mockedWriteClipboard);
  });

  afterEach(() => {
    mockStore.clear();
    vi.resetAllMocks();
    delete (globalThis as any).browser;
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
    mockStore.clear();
    const mockedDotCommand = {
      getMockName: () => 'tauri.get_platform.info',
      mockClear: vi.fn(),
    };
    const mockedNonDotCommand = {
      getMockName: () => 'tauri.get_platformXinfo',
      mockClear: vi.fn(),
    };
    mockStore.setMock(globalThis.browser, mockedDotCommand as any);
    mockStore.setMock(globalThis.browser, mockedNonDotCommand as any);

    await clearAllMocks('get_platform.info');
    expect(mockedDotCommand.mockClear).toHaveBeenCalled();
    expect(mockedNonDotCommand.mockClear).not.toHaveBeenCalled();
  });

  it('should throw when no browser context is available', async () => {
    delete (globalThis as any).browser;
    await expect(clearAllMocks.call({})).rejects.toThrow('clearAllMocks requires a valid browser context');
  });

  describe('in multiremote', () => {
    it("should clear only the calling instance's mocks", async () => {
      const { root, browserA, browserB } = createFakeMultiremote();
      const mockA = { getMockName: () => 'tauri.read_clipboard', mockClear: vi.fn() };
      const mockB = { getMockName: () => 'tauri.read_clipboard', mockClear: vi.fn() };
      mockStore.setMock(browserA, mockA as any);
      mockStore.setMock(browserB, mockB as any);
      globalThis.browser = root as any;

      await clearAllMocks.call({ browser: browserA });

      expect(mockA.mockClear).toHaveBeenCalled();
      expect(mockB.mockClear).not.toHaveBeenCalled();
    });

    it("should clear every instance's mocks, and the root's own, on the root", async () => {
      const { root, browserA, browserB } = createFakeMultiremote();
      const mocks = [browserA, browserB, root].map((owner) => {
        const mock = { getMockName: () => 'tauri.read_clipboard', mockClear: vi.fn() };
        mockStore.setMock(owner, mock as any);
        return mock;
      });

      await clearAllMocks.call({ browser: root }, 'read');

      for (const mock of mocks) {
        expect(mock.mockClear).toHaveBeenCalledOnce();
      }
    });
  });
});
