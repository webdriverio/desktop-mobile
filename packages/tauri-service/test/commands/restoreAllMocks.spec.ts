import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { restoreAllMocks } from '../../src/commands/mock.js';
import mockStore from '../../src/mockStore.js';
import { createFakeMultiremote } from './multiremoteFakes.js';

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
    mockStore.setMock(globalThis.browser, mockedGetPlatformInfo);
    mockStore.setMock(globalThis.browser, mockedReadClipboard);
    mockStore.setMock(globalThis.browser, mockedWriteClipboard);
  });

  afterEach(() => {
    mockStore.clear();
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

  describe('in multiremote', () => {
    let fakes: ReturnType<typeof createFakeMultiremote>;
    let mockA: any, mockB: any, rootMock: any;

    beforeEach(() => {
      mockStore.clear();
      fakes = createFakeMultiremote();
      globalThis.browser = fakes.root as any;
      mockA = { getMockName: () => 'tauri.read_clipboard', mockRestore: vi.fn() };
      mockB = { getMockName: () => 'tauri.read_clipboard', mockRestore: vi.fn() };
      rootMock = { getMockName: () => 'tauri.read_clipboard', mockRestore: vi.fn() };
      mockStore.setMock(fakes.browserA, mockA);
      mockStore.setMock(fakes.browserB, mockB);
      mockStore.setMock(fakes.root, rootMock);
    });

    it("should restore only the calling instance's mocks, in its own app", async () => {
      await restoreAllMocks.call({ browser: fakes.browserA });

      expect(mockA.mockRestore).toHaveBeenCalledOnce();
      expect(fakes.browserA.execute).toHaveBeenCalledWith(expect.any(Function), '');
      expect(mockB.mockRestore).not.toHaveBeenCalled();
      expect(fakes.browserB.execute).not.toHaveBeenCalled();
      expect(rootMock.mockRestore).not.toHaveBeenCalled();
    });

    it("should restore every instance's mocks, and the root's own, on the root", async () => {
      await restoreAllMocks.call({ browser: fakes.root }, 'read');

      for (const mock of [mockA, mockB, rootMock]) {
        expect(mock.mockRestore).toHaveBeenCalledOnce();
      }
      expect(fakes.browserA.execute).toHaveBeenCalledWith(expect.any(Function), 'read');
      expect(fakes.browserB.execute).toHaveBeenCalledWith(expect.any(Function), 'read');
      expect(fakes.root.execute).not.toHaveBeenCalled();
    });

    it('should finish the other instances before reporting the one that failed', async () => {
      const failure = new Error('script error');
      vi.mocked(fakes.browserA.execute).mockRejectedValueOnce(failure);

      await expect(restoreAllMocks.call({ browser: fakes.root })).rejects.toMatchObject({
        message: 'restoreAllMocks failed on browserA: mockRestore failed: all mocks (in-app): script error',
        cause: { errors: [failure] },
      });

      for (const mock of [mockA, mockB, rootMock]) {
        expect(mock.mockRestore).toHaveBeenCalledOnce();
      }
      expect(fakes.browserB.execute).toHaveBeenCalled();
    });

    it('should keep restoring the other instances when getInstance throws for one', async () => {
      const root = {
        ...fakes.root,
        getInstance: (name: string) => {
          if (name === 'browserA') {
            throw new Error('Multi-remote object has no instance named "browserA"');
          }
          return fakes.browserB;
        },
      } as unknown as WebdriverIO.MultiRemoteBrowser;
      mockStore.setMock(root, rootMock);

      await expect(restoreAllMocks.call({ browser: root })).rejects.toMatchObject({
        message: 'restoreAllMocks failed on browserA: Multi-remote object has no instance named "browserA"',
      });

      expect(mockB.mockRestore).toHaveBeenCalledOnce();
      expect(rootMock.mockRestore).toHaveBeenCalledOnce();
    });

    it('should report every instance that failed', async () => {
      vi.mocked(fakes.browserA.execute).mockRejectedValueOnce(new Error('a failed'));
      rootMock.mockRestore.mockRejectedValueOnce(new Error('root failed'));

      await expect(restoreAllMocks.call({ browser: fakes.root })).rejects.toMatchObject({
        message:
          'restoreAllMocks failed on browserA: mockRestore failed: all mocks (in-app): a failed; ' +
          'the multiremote root: mockRestore failed: tauri.read_clipboard: root failed',
        errors: [{ message: expect.stringContaining('a failed') }, { message: expect.stringContaining('root failed') }],
      });
    });
  });
});
