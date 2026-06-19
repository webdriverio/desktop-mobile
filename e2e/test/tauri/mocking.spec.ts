import { browser, expect } from '@wdio/globals';
import '@wdio/native-types';

describe('Tauri Mocking', () => {
  describe('browser.tauri.mock', () => {
    it('should mock a tauri command', async () => {
      const mockGetPlatformInfo = await browser.tauri.mock('get_platform_info');

      await browser.tauri.execute(async ({ core }) => {
        await core.invoke('get_platform_info');
      });

      await mockGetPlatformInfo.update();

      expect(mockGetPlatformInfo).toHaveBeenCalledTimes(1);
    });

    it('should mock a command with arguments', async () => {
      const mockWriteClipboard = await browser.tauri.mock('write_clipboard');

      await browser.tauri.execute(async ({ core }) => {
        await core.invoke('write_clipboard', { content: 'test content' });
      });

      await mockWriteClipboard.update();

      expect(mockWriteClipboard).toHaveBeenCalledTimes(1);
      expect(mockWriteClipboard).toHaveBeenCalledWith({ content: 'test content' });
    });
  });

  describe('browser.tauri.clearAllMocks', () => {
    it('should clear existing mocks', async () => {
      const mockReadClipboard = await browser.tauri.mock('read_clipboard');
      const mockWriteClipboard = await browser.tauri.mock('write_clipboard');

      await browser.tauri.execute(async ({ core }) => {
        await core.invoke('read_clipboard');
      });
      await browser.tauri.execute(async ({ core }) => {
        await core.invoke('write_clipboard', { content: 'test content' });
      });

      await mockReadClipboard.update();
      await mockWriteClipboard.update();

      await browser.tauri.clearAllMocks();

      expect(mockReadClipboard.mock.calls).toStrictEqual([]);
      expect(mockReadClipboard.mock.invocationCallOrder).toStrictEqual([]);
      expect(mockReadClipboard.mock.lastCall).toBeUndefined();
      expect(mockReadClipboard.mock.results).toStrictEqual([]);

      expect(mockWriteClipboard.mock.calls).toStrictEqual([]);
      expect(mockWriteClipboard.mock.invocationCallOrder).toStrictEqual([]);
      expect(mockWriteClipboard.mock.lastCall).toBeUndefined();
      expect(mockWriteClipboard.mock.results).toStrictEqual([]);
    });

    it('should not reset existing mocks', async () => {
      const mockReadClipboard = await browser.tauri.mock('read_clipboard');
      const mockGetPlatformInfo = await browser.tauri.mock('get_platform_info');

      await mockReadClipboard.mockReturnValue('mocked clipboard content');
      await mockGetPlatformInfo.mockReturnValue({ os: 'mock_os', arch: 'mock_arch' });

      await browser.tauri.clearAllMocks();

      const clipboardContent = await browser.tauri.execute(async ({ core }) => await core.invoke('read_clipboard'));
      const platformInfo = await browser.tauri.execute(async ({ core }) => await core.invoke('get_platform_info'));

      expect(clipboardContent).toBe('mocked clipboard content');
      expect(platformInfo).toEqual({ os: 'mock_os', arch: 'mock_arch' });
    });
  });

  describe('browser.tauri.resetAllMocks', () => {
    it('should clear existing mocks', async () => {
      const mockReadClipboard = await browser.tauri.mock('read_clipboard');
      const mockGetPlatformInfo = await browser.tauri.mock('get_platform_info');

      await mockReadClipboard.mockReturnValue('mocked clipboard');
      await mockGetPlatformInfo.mockReturnValue({ os: 'mock_os' });

      await browser.tauri.execute(async ({ core }) => {
        await core.invoke('read_clipboard');
      });
      await browser.tauri.execute(async ({ core }) => {
        await core.invoke('get_platform_info');
      });

      await mockReadClipboard.update();
      await mockGetPlatformInfo.update();

      await browser.tauri.resetAllMocks();

      expect(mockReadClipboard.mock.calls).toStrictEqual([]);
      expect(mockReadClipboard.mock.invocationCallOrder).toStrictEqual([]);
      expect(mockReadClipboard.mock.lastCall).toBeUndefined();
      expect(mockReadClipboard.mock.results).toStrictEqual([]);

      expect(mockGetPlatformInfo.mock.calls).toStrictEqual([]);
      expect(mockGetPlatformInfo.mock.invocationCallOrder).toStrictEqual([]);
      expect(mockGetPlatformInfo.mock.lastCall).toBeUndefined();
      expect(mockGetPlatformInfo.mock.results).toStrictEqual([]);
    });

    it('should reset existing mocks', async () => {
      const mockReadClipboard = await browser.tauri.mock('read_clipboard');
      const mockGetPlatformInfo = await browser.tauri.mock('get_platform_info');

      await mockReadClipboard.mockReturnValue('mocked clipboard');
      await mockGetPlatformInfo.mockReturnValue({ os: 'mock_os' });

      await browser.tauri.resetAllMocks();

      const clipboardContent = await browser.tauri.execute(async ({ core }) => await core.invoke('read_clipboard'));
      const platformInfo = await browser.tauri.execute(async ({ core }) => await core.invoke('get_platform_info'));

      expect(clipboardContent).toBeUndefined();
      expect(platformInfo).toBeUndefined();
    });
  });

  describe('browser.tauri.restoreAllMocks', () => {
    it('should restore existing mocks', async () => {
      const mockReadClipboard = await browser.tauri.mock('read_clipboard');
      const mockGetPlatformInfo = await browser.tauri.mock('get_platform_info');

      await mockReadClipboard.mockReturnValue('mocked clipboard');
      await mockGetPlatformInfo.mockReturnValue({ os: 'mock_os' });

      await browser.tauri.restoreAllMocks();

      // Write to clipboard AFTER restoring — any write_clipboard mock from prior tests is now gone
      await browser.tauri.execute(async ({ core }) => {
        await core.invoke('write_clipboard', { content: 'real clipboard text' });
      });

      const clipboardContent = await browser.tauri.execute(async ({ core }) => await core.invoke('read_clipboard'));
      const platformInfo = await browser.tauri.execute(async ({ core }) => await core.invoke('get_platform_info'));

      // After restore, should return real values
      expect(typeof clipboardContent).toBe('string');
      expect(platformInfo).toHaveProperty('os');
      expect(platformInfo).toHaveProperty('arch');
    });
  });

  describe('browser.tauri.isMockFunction', () => {
    it('should return true when provided with a tauri mock', async () => {
      // Create mock to register it in the store
      void (await browser.tauri.mock('read_clipboard'));

      expect(await browser.tauri.isMockFunction('read_clipboard')).toBe(true);
    });

    it('should return false when provided with a non-mocked command', async () => {
      expect(await browser.tauri.isMockFunction('non_existent_command')).toBe(false);
    });
  });

  describe('mock object functionality', () => {
    describe('mockImplementation', () => {
      it('should use the specified implementation for an existing mock', async () => {
        const mockReadClipboard = await browser.tauri.mock('read_clipboard');

        await mockReadClipboard.mockImplementation(() => 'mocked clipboard value');

        const result = await browser.tauri.execute(async ({ core }) => await core.invoke('read_clipboard'));

        expect(mockReadClipboard.mock.calls).toHaveLength(1);
        expect(result).toBe('mocked clipboard value');
      });
    });

    describe('mockImplementationOnce', () => {
      it('should use the specified implementation for an existing mock once', async () => {
        const mockReadClipboard = await browser.tauri.mock('read_clipboard');

        await mockReadClipboard.mockImplementation(() => 'default mocked clipboard');
        await mockReadClipboard.mockImplementationOnce(() => 'first mocked clipboard');
        await mockReadClipboard.mockImplementationOnce(() => 'second mocked clipboard');
        await mockReadClipboard.mockImplementationOnce(() => 'third mocked clipboard');

        let content = await browser.tauri.execute(async ({ core }) => await core.invoke('read_clipboard'));
        expect(content).toBe('first mocked clipboard');

        content = await browser.tauri.execute(async ({ core }) => await core.invoke('read_clipboard'));
        expect(content).toBe('second mocked clipboard');

        content = await browser.tauri.execute(async ({ core }) => await core.invoke('read_clipboard'));
        expect(content).toBe('third mocked clipboard');

        content = await browser.tauri.execute(async ({ core }) => await core.invoke('read_clipboard'));
        expect(content).toBe('default mocked clipboard');

        content = await browser.tauri.execute(async ({ core }) => await core.invoke('read_clipboard'));
        expect(content).toBe('default mocked clipboard');
      });
    });

    describe('mockReturnValue', () => {
      it('should return the specified value from an existing mock', async () => {
        const mockReadClipboard = await browser.tauri.mock('read_clipboard');
        await mockReadClipboard.mockReturnValue('This is a mock');

        const content = await browser.tauri.execute(async ({ core }) => await core.invoke('read_clipboard'));

        expect(content).toBe('This is a mock');
      });
    });

    describe('mockReturnValueOnce', () => {
      it('should return the specified value from an existing mock once', async () => {
        const mockReadClipboard = await browser.tauri.mock('read_clipboard');

        await mockReadClipboard.mockReturnValue('default mocked clipboard');
        await mockReadClipboard.mockReturnValueOnce('first mocked clipboard');
        await mockReadClipboard.mockReturnValueOnce('second mocked clipboard');
        await mockReadClipboard.mockReturnValueOnce('third mocked clipboard');

        let content = await browser.tauri.execute(async ({ core }) => await core.invoke('read_clipboard'));
        expect(content).toBe('first mocked clipboard');

        content = await browser.tauri.execute(async ({ core }) => await core.invoke('read_clipboard'));
        expect(content).toBe('second mocked clipboard');

        content = await browser.tauri.execute(async ({ core }) => await core.invoke('read_clipboard'));
        expect(content).toBe('third mocked clipboard');

        content = await browser.tauri.execute(async ({ core }) => await core.invoke('read_clipboard'));
        expect(content).toBe('default mocked clipboard');

        content = await browser.tauri.execute(async ({ core }) => await core.invoke('read_clipboard'));
        expect(content).toBe('default mocked clipboard');
      });
    });

    describe('mockResolvedValue', () => {
      it('should resolve with the specified value from an existing mock', async () => {
        const mockGetPlatformInfo = await browser.tauri.mock('get_platform_info');
        await mockGetPlatformInfo.mockResolvedValue({ os: 'MockOS', arch: 'mock64' });

        const platformInfo = await browser.tauri.execute(async ({ core }) => await core.invoke('get_platform_info'));

        expect(platformInfo).toEqual({ os: 'MockOS', arch: 'mock64' });
      });
    });

    describe('mockResolvedValueOnce', () => {
      it('should resolve with the specified value from an existing mock once', async () => {
        const mockGetPlatformInfo = await browser.tauri.mock('get_platform_info');

        await mockGetPlatformInfo.mockResolvedValue({ os: 'default_os' });
        await mockGetPlatformInfo.mockResolvedValueOnce({ os: 'first_os' });
        await mockGetPlatformInfo.mockResolvedValueOnce({ os: 'second_os' });
        await mockGetPlatformInfo.mockResolvedValueOnce({ os: 'third_os' });

        let info = await browser.tauri.execute(async ({ core }) => await core.invoke('get_platform_info'));
        expect(info).toEqual({ os: 'first_os' });

        info = await browser.tauri.execute(async ({ core }) => await core.invoke('get_platform_info'));
        expect(info).toEqual({ os: 'second_os' });

        info = await browser.tauri.execute(async ({ core }) => await core.invoke('get_platform_info'));
        expect(info).toEqual({ os: 'third_os' });

        info = await browser.tauri.execute(async ({ core }) => await core.invoke('get_platform_info'));
        expect(info).toEqual({ os: 'default_os' });

        info = await browser.tauri.execute(async ({ core }) => await core.invoke('get_platform_info'));
        expect(info).toEqual({ os: 'default_os' });
      });
    });

    describe('mockRejectedValue', () => {
      it('should reject with the specified value from an existing mock', async () => {
        const mockGetPlatformInfo = await browser.tauri.mock('get_platform_info');
        await mockGetPlatformInfo.mockRejectedValue('This is a mock error');

        const error = await browser.tauri.execute(async ({ core }) => {
          try {
            return await core.invoke('get_platform_info');
          } catch (e) {
            return e;
          }
        });

        expect(error).toBe('This is a mock error');
      });

      it('should reject with an Error object preserving message', async () => {
        const mockGetPlatformInfo = await browser.tauri.mock('get_platform_info');
        await mockGetPlatformInfo.mockRejectedValue(new Error('connection failed'));

        const error = await browser.tauri.execute(async ({ core }) => {
          try {
            return await core.invoke('get_platform_info');
          } catch (e) {
            return e instanceof Error ? e.message : String(e);
          }
        });

        expect(error).toBe('connection failed');
      });
    });

    describe('mockRejectedValueOnce', () => {
      it('should reject with the specified value from an existing mock once', async () => {
        const mockGetPlatformInfo = await browser.tauri.mock('get_platform_info');

        await mockGetPlatformInfo.mockRejectedValue('default error');
        await mockGetPlatformInfo.mockRejectedValueOnce('first error');
        await mockGetPlatformInfo.mockRejectedValueOnce('second error');
        await mockGetPlatformInfo.mockRejectedValueOnce('third error');

        const getInfo = async () =>
          await browser.tauri.execute(async ({ core }) => {
            try {
              return await core.invoke('get_platform_info');
            } catch (e) {
              return e;
            }
          });

        let info = await getInfo();
        expect(info).toBe('first error');

        info = await getInfo();
        expect(info).toBe('second error');

        info = await getInfo();
        expect(info).toBe('third error');

        info = await getInfo();
        expect(info).toBe('default error');

        info = await getInfo();
        expect(info).toBe('default error');
      });

      it('should reject with Error objects preserving message', async () => {
        const mockGetPlatformInfo = await browser.tauri.mock('get_platform_info');

        await mockGetPlatformInfo.mockRejectedValue(new Error('default error'));
        await mockGetPlatformInfo.mockRejectedValueOnce(new Error('first error'));
        await mockGetPlatformInfo.mockRejectedValueOnce(new Error('second error'));

        const getMsg = async () =>
          await browser.tauri.execute(async ({ core }) => {
            try {
              return await core.invoke('get_platform_info');
            } catch (e) {
              return e instanceof Error ? e.message : String(e);
            }
          });

        expect(await getMsg()).toBe('first error');
        expect(await getMsg()).toBe('second error');
        expect(await getMsg()).toBe('default error');
      });
    });

    describe('mockClear', () => {
      it('should clear an existing mock', async () => {
        const mockReadClipboard = await browser.tauri.mock('read_clipboard');
        await mockReadClipboard.mockReturnValue('mocked clipboard');

        await browser.tauri.execute(async ({ core }) => await core.invoke('read_clipboard'));
        await browser.tauri.execute(async ({ core }) => await core.invoke('read_clipboard'));
        await browser.tauri.execute(async ({ core }) => await core.invoke('read_clipboard'));

        await mockReadClipboard.update();
        await mockReadClipboard.mockClear();

        expect(mockReadClipboard.mock.calls).toStrictEqual([]);
        expect(mockReadClipboard.mock.invocationCallOrder).toStrictEqual([]);
        expect(mockReadClipboard.mock.lastCall).toBeUndefined();
        expect(mockReadClipboard.mock.results).toStrictEqual([]);
      });
    });

    describe('mockReset', () => {
      it('should reset the implementation of an existing mock', async () => {
        const mockReadClipboard = await browser.tauri.mock('read_clipboard');
        await mockReadClipboard.mockReturnValue('mocked clipboard');

        await mockReadClipboard.mockReset();

        const content = await browser.tauri.execute(async ({ core }) => await core.invoke('read_clipboard'));
        expect(content).toBeUndefined();
      });

      it('should reset mockReturnValueOnce implementations of an existing mock', async () => {
        const mockReadClipboard = await browser.tauri.mock('read_clipboard');
        await mockReadClipboard.mockReturnValueOnce('first');
        await mockReadClipboard.mockReturnValueOnce('second');
        await mockReadClipboard.mockReturnValueOnce('third');

        await mockReadClipboard.mockReset();

        const content = await browser.tauri.execute(async ({ core }) => await core.invoke('read_clipboard'));
        expect(content).toBeUndefined();
      });

      it('should reset mockImplementationOnce implementations of an existing mock', async () => {
        const mockReadClipboard = await browser.tauri.mock('read_clipboard');
        await mockReadClipboard.mockImplementationOnce(() => 'first');
        await mockReadClipboard.mockImplementationOnce(() => 'second');
        await mockReadClipboard.mockImplementationOnce(() => 'third');

        await mockReadClipboard.mockReset();

        const content = await browser.tauri.execute(async ({ core }) => await core.invoke('read_clipboard'));
        expect(content).toBeUndefined();
      });

      it('should clear the history of an existing mock', async () => {
        const mockReadClipboard = await browser.tauri.mock('read_clipboard');
        await mockReadClipboard.mockReturnValue('mocked clipboard');

        await browser.tauri.execute(async ({ core }) => await core.invoke('read_clipboard'));
        await browser.tauri.execute(async ({ core }) => await core.invoke('read_clipboard'));
        await browser.tauri.execute(async ({ core }) => await core.invoke('read_clipboard'));

        await mockReadClipboard.update();
        await mockReadClipboard.mockReset();

        expect(mockReadClipboard.mock.calls).toStrictEqual([]);
        expect(mockReadClipboard.mock.invocationCallOrder).toStrictEqual([]);
        expect(mockReadClipboard.mock.lastCall).toBeUndefined();
        expect(mockReadClipboard.mock.results).toStrictEqual([]);
      });
    });

    describe('mockRestore', () => {
      it('should restore an existing mock', async () => {
        // First set a real clipboard value
        await browser.tauri.execute(async ({ core }) => {
          await core.invoke('write_clipboard', { content: 'real clipboard text' });
        });

        const mockReadClipboard = await browser.tauri.mock('read_clipboard');
        await mockReadClipboard.mockReturnValue('mocked clipboard');

        await mockReadClipboard.mockRestore();

        const content = await browser.tauri.execute(async ({ core }) => await core.invoke('read_clipboard'));

        // After restore, should return real clipboard value
        expect(content).toBe('real clipboard text');
      });
    });

    describe('getMockName', () => {
      it('should retrieve the mock name', async () => {
        const mockReadClipboard = await browser.tauri.mock('read_clipboard');

        expect(mockReadClipboard.getMockName()).toBe('tauri.read_clipboard');
      });
    });

    describe('mockName', () => {
      it('should set the mock name', async () => {
        const mockReadClipboard = await browser.tauri.mock('read_clipboard');
        mockReadClipboard.mockName('my first mock');

        expect(mockReadClipboard.getMockName()).toBe('my first mock');
      });
    });

    describe('getMockImplementation', () => {
      it('should retrieve the mock implementation', async () => {
        const mockReadClipboard = await browser.tauri.mock('read_clipboard');
        await mockReadClipboard.mockImplementation(() => 'mocked clipboard');
        const mockImpl = mockReadClipboard.getMockImplementation() as () => string;

        expect(mockImpl()).toBe('mocked clipboard');
      });

      it('should retrieve an empty mock implementation', async () => {
        const mockReadClipboard = await browser.tauri.mock('read_clipboard');
        const mockImpl = mockReadClipboard.getMockImplementation() as () => undefined;

        expect(mockImpl).toBeUndefined();
      });
    });

    describe('mock.calls', () => {
      it('should return the calls of the mock execution', async () => {
        const mockWriteClipboard = await browser.tauri.mock('write_clipboard');

        await browser.tauri.execute(
          async ({ core }) => await core.invoke('write_clipboard', { content: 'first content' }),
        );
        await browser.tauri.execute(
          async ({ core }) => await core.invoke('write_clipboard', { content: 'second content' }),
        );

        await mockWriteClipboard.update();

        expect(mockWriteClipboard.mock.calls).toHaveLength(2);
      });

      it('should return an empty array when the mock was never invoked', async () => {
        const mockReadClipboard = await browser.tauri.mock('read_clipboard');

        expect(mockReadClipboard.mock.calls).toStrictEqual([]);
      });
    });

    describe('mock.lastCall', () => {
      it('should return the last call of the mock execution', async () => {
        const mockWriteClipboard = await browser.tauri.mock('write_clipboard');

        await browser.tauri.execute(async ({ core }) => await core.invoke('write_clipboard', { content: 'first' }));
        await mockWriteClipboard.update();
        expect(mockWriteClipboard.mock.lastCall).toBeDefined();

        await browser.tauri.execute(async ({ core }) => await core.invoke('write_clipboard', { content: 'second' }));
        await mockWriteClipboard.update();
        expect(mockWriteClipboard.mock.lastCall).toBeDefined();

        await browser.tauri.execute(async ({ core }) => await core.invoke('write_clipboard', { content: 'third' }));
        await mockWriteClipboard.update();
        expect(mockWriteClipboard.mock.lastCall).toBeDefined();
      });

      it('should return undefined when the mock was never invoked', async () => {
        const mockReadClipboard = await browser.tauri.mock('read_clipboard');

        expect(mockReadClipboard.mock.lastCall).toBeUndefined();
      });
    });

    describe('mock.results', () => {
      it('should return the results of the mock execution', async () => {
        const mockReadClipboard = await browser.tauri.mock('read_clipboard');

        await mockReadClipboard.mockImplementation(() => 'result');

        await browser.tauri.execute(async ({ core }) => await core.invoke('read_clipboard'));

        await mockReadClipboard.update();

        expect(mockReadClipboard.mock.results).toStrictEqual([
          {
            type: 'return',
            value: 'result',
          },
        ]);
      });

      it('should return an empty array when the mock was never invoked', async () => {
        const mockReadClipboard = await browser.tauri.mock('read_clipboard');

        expect(mockReadClipboard.mock.results).toStrictEqual([]);
      });
    });

    describe('mock.invocationCallOrder', () => {
      it('should return the order of execution', async () => {
        const mockReadClipboard = await browser.tauri.mock('read_clipboard');
        const mockGetPlatformInfo = await browser.tauri.mock('get_platform_info');

        await browser.tauri.execute(async ({ core }) => await core.invoke('read_clipboard'));
        await browser.tauri.execute(async ({ core }) => await core.invoke('get_platform_info'));
        await browser.tauri.execute(async ({ core }) => await core.invoke('read_clipboard'));

        await mockReadClipboard.update();
        await mockGetPlatformInfo.update();

        const firstInvocationIndex = mockReadClipboard.mock.invocationCallOrder[0];

        expect(mockReadClipboard.mock.invocationCallOrder).toStrictEqual([
          firstInvocationIndex,
          firstInvocationIndex + 2,
        ]);
        expect(mockGetPlatformInfo.mock.invocationCallOrder).toStrictEqual([firstInvocationIndex + 1]);
      });

      it('should return an empty array when the mock was never invoked', async () => {
        const mockReadClipboard = await browser.tauri.mock('read_clipboard');

        expect(mockReadClipboard.mock.invocationCallOrder).toStrictEqual([]);
      });
    });

    describe('synchronization', () => {
      it('should synchronize mock calls after update', async () => {
        const mockReadClipboard = await browser.tauri.mock('read_clipboard');

        // Use browser.execute (raw WebDriver, no auto-sync) to invoke the inner mock directly
        await browser.execute(() => {
          // @ts-expect-error - window is available in browser context
          const mockFn = window.__wdio_mocks__?.read_clipboard;
          if (typeof mockFn === 'function') {
            mockFn();
            mockFn();
          }
        });

        // Before update(), outer mock has no calls (inner mock has 2)
        expect(mockReadClipboard.mock.calls).toStrictEqual([]);

        await mockReadClipboard.update();

        // After update(), calls are synchronized from inner mock
        expect(mockReadClipboard.mock.calls).toHaveLength(2);
      });

      it('should auto-synchronize mock calls after execute', async () => {
        const mockReadClipboard = await browser.tauri.mock('read_clipboard');

        await browser.tauri.execute(async ({ core }) => {
          await core.invoke('read_clipboard');
          await core.invoke('read_clipboard');
        });

        // After tauri.execute (auto-synced), calls should be synchronized without calling update()
        expect(mockReadClipboard.mock.calls).toHaveLength(2);
      });

      it('should synchronize mock results after update', async () => {
        const mockReadClipboard = await browser.tauri.mock('read_clipboard');
        await mockReadClipboard.mockReturnValue('mocked result');

        await browser.tauri.execute(async ({ core }) => {
          await core.invoke('read_clipboard');
        });

        await mockReadClipboard.update();

        expect(mockReadClipboard.mock.results).toHaveLength(1);
      });

      it('should synchronize lastCall after update', async () => {
        const mockWriteClipboard = await browser.tauri.mock('write_clipboard');

        await browser.tauri.execute(async ({ core }) => {
          await core.invoke('write_clipboard', { content: 'test' });
        });

        await mockWriteClipboard.update();

        expect(mockWriteClipboard.mock.lastCall).toBeDefined();
      });
    });

    describe('mock state persistence', () => {
      it('should maintain mock implementation across invocations', async () => {
        const mockReadClipboard = await browser.tauri.mock('read_clipboard');
        await mockReadClipboard.mockReturnValue('persistent result');

        // First call
        const result1 = await browser.tauri.execute(async ({ core }) => {
          return await core.invoke('read_clipboard');
        });

        await mockReadClipboard.update();
        expect(result1).toBe('persistent result');

        // Second call should return same result
        const result2 = await browser.tauri.execute(async ({ core }) => {
          return await core.invoke('read_clipboard');
        });

        await mockReadClipboard.update();
        expect(result2).toBe('persistent result');
        expect(mockReadClipboard.mock.calls).toHaveLength(2);
      });
    });
  });
});
