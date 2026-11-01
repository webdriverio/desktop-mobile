import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetAllMocks } from '../../src/commands/mock.js';
import mockStore from '../../src/mockStore.js';
import { createFakeMultiremote } from './multiremoteFakes.js';

describe('resetAllMocks Command', () => {
  let mockedGetPlatformInfo: any, mockedReadClipboard: any, mockedWriteClipboard: any;

  beforeEach(async () => {
    globalThis.browser = {
      execute: vi.fn().mockResolvedValue(undefined),
    } as unknown as WebdriverIO.Browser;

    mockedGetPlatformInfo = {
      getMockName: () => 'tauri.get_platform_info',
      mockReset: vi.fn(),
    };
    mockedReadClipboard = {
      getMockName: () => 'tauri.read_clipboard',
      mockReset: vi.fn(),
    };
    mockedWriteClipboard = {
      getMockName: () => 'tauri.write_clipboard',
      mockReset: vi.fn(),
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

  it('should reset all mocks in the injection script when no prefix is provided', async () => {
    await resetAllMocks();
    expect((globalThis.browser as any).execute).toHaveBeenCalledWith(expect.any(Function), '');

    const callback = (globalThis.browser as any).execute.mock.calls[0][0];
    const mockResetFn = vi.fn();
    const mockWindow = {
      __wdio_mocks__: {
        get_platform_info: { mockReset: mockResetFn },
        read_clipboard: { mockReset: mockResetFn },
      },
    };
    (globalThis as any).window = mockWindow;
    try {
      callback(undefined);
      expect(mockResetFn).toHaveBeenCalledTimes(2);
    } finally {
      delete (globalThis as any).window;
    }
  });

  it('should reset all outer mock functions when no prefix is provided', async () => {
    await resetAllMocks();
    expect(mockedGetPlatformInfo.mockReset).toHaveBeenCalled();
    expect(mockedReadClipboard.mockReset).toHaveBeenCalled();
    expect(mockedWriteClipboard.mockReset).toHaveBeenCalled();
  });

  it('should reset only mocks matching the command prefix', async () => {
    await resetAllMocks('read');
    expect(mockedGetPlatformInfo.mockReset).not.toHaveBeenCalled();
    expect(mockedReadClipboard.mockReset).toHaveBeenCalled();
    expect(mockedWriteClipboard.mockReset).not.toHaveBeenCalled();
  });

  it('should pass prefix to browser execute for inner mock filtering', async () => {
    await resetAllMocks('write');
    expect((globalThis.browser as any).execute).toHaveBeenCalledWith(expect.any(Function), 'write');

    const callback = (globalThis.browser as any).execute.mock.calls[0][0];
    const resetPlatform = vi.fn();
    const resetWrite = vi.fn();
    const mockWindow = {
      __wdio_mocks__: {
        get_platform_info: { mockReset: resetPlatform },
        write_clipboard: { mockReset: resetWrite },
      },
    };
    (globalThis as any).window = mockWindow;
    try {
      callback('write');
      expect(resetPlatform).not.toHaveBeenCalled();
      expect(resetWrite).toHaveBeenCalledTimes(1);
    } finally {
      delete (globalThis as any).window;
    }
  });

  it('should handle prefix that matches no mocks', async () => {
    await resetAllMocks('nonexistent');
    expect(mockedGetPlatformInfo.mockReset).not.toHaveBeenCalled();
    expect(mockedReadClipboard.mockReset).not.toHaveBeenCalled();
    expect(mockedWriteClipboard.mockReset).not.toHaveBeenCalled();
  });

  it('should attempt every mock and then report the one whose mockReset failed', async () => {
    mockedGetPlatformInfo.mockReset.mockRejectedValue(new Error('inner mock gone'));

    await expect(resetAllMocks()).rejects.toMatchObject({
      message: 'mockReset failed: tauri.get_platform_info: inner mock gone',
    });

    expect(mockedReadClipboard.mockReset).toHaveBeenCalled();
    expect(mockedWriteClipboard.mockReset).toHaveBeenCalled();
  });

  it('should still run every mockReset and report the failure when the in-app bulk call fails', async () => {
    (globalThis.browser as any).execute.mockRejectedValue(new Error('script error'));

    await expect(resetAllMocks()).rejects.toMatchObject({
      message: 'mockReset failed: all mocks (in-app): script error',
    });

    expect(mockedGetPlatformInfo.mockReset).toHaveBeenCalled();
    expect(mockedReadClipboard.mockReset).toHaveBeenCalled();
    expect(mockedWriteClipboard.mockReset).toHaveBeenCalled();
  });

  it('should throw when no browser context is available', async () => {
    delete (globalThis as any).browser;
    await expect(resetAllMocks.call({})).rejects.toThrow('resetAllMocks requires a valid browser context');
  });

  describe('in multiremote', () => {
    let fakes: ReturnType<typeof createFakeMultiremote>;
    let mockA: any, mockB: any;

    beforeEach(() => {
      mockStore.clear();
      fakes = createFakeMultiremote();
      globalThis.browser = fakes.root as any;
      mockA = { getMockName: () => 'tauri.read_clipboard', mockReset: vi.fn() };
      mockB = { getMockName: () => 'tauri.read_clipboard', mockReset: vi.fn() };
      mockStore.setMock(fakes.browserA, mockA);
      mockStore.setMock(fakes.browserB, mockB);
    });

    it("should reset only the calling instance's mocks, in its own app", async () => {
      await resetAllMocks.call({ browser: fakes.browserB }, 'read');

      expect(mockB.mockReset).toHaveBeenCalledOnce();
      expect(fakes.browserB.execute).toHaveBeenCalledWith(expect.any(Function), 'read');
      expect(mockA.mockReset).not.toHaveBeenCalled();
      expect(fakes.browserA.execute).not.toHaveBeenCalled();
    });

    it("should reset every instance's mocks on the root, in each instance's app", async () => {
      await resetAllMocks.call({});

      expect(mockA.mockReset).toHaveBeenCalledOnce();
      expect(mockB.mockReset).toHaveBeenCalledOnce();
      expect(fakes.browserA.execute).toHaveBeenCalledWith(expect.any(Function), '');
      expect(fakes.browserB.execute).toHaveBeenCalledWith(expect.any(Function), '');
      expect(fakes.root.execute).not.toHaveBeenCalled();
    });
  });
});
