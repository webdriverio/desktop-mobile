import { browser, expect } from '@wdio/globals';
import '@wdio/native-types';

// Electrobun mocks wrap a function in the webview global scope (window.<target>);
// there is no enumerable main-process API (unlike Electron). The fixture does not
// expose such a function, so each test installs one via execute() first, then
// mocks it — the in-page analogue of mocking a tauri command / dioxus invoke.
// In the webview globalThis === window, so functions defined here are reachable
// by the inner recorder's window.<target> lookup.
async function defineTarget(name: string): Promise<void> {
  await browser.electrobun.execute((_eb, fnName) => {
    // Real implementation that the mock replaces in place.
    (globalThis as unknown as Record<string, unknown>)[fnName as string] = (...args: unknown[]) => ({
      real: true,
      args,
    });
  }, name);
}

async function callTarget(name: string, ...args: unknown[]): Promise<unknown> {
  return browser.electrobun.execute(
    (_eb, fnName, callArgs) =>
      (globalThis as unknown as Record<string, (...a: unknown[]) => unknown>)[fnName as string](
        ...(callArgs as unknown[]),
      ),
    name,
    args,
  );
}

describe('Electrobun Mocking', () => {
  beforeEach(async () => {
    await browser.electrobun.restoreAllMocks();
  });

  describe('browser.electrobun.mock', () => {
    it('should mock a webview function', async () => {
      await defineTarget('getValue');
      const mockGetValue = await browser.electrobun.mock('getValue');

      await callTarget('getValue');
      await mockGetValue.update();

      expect(mockGetValue).toHaveBeenCalledTimes(1);
    });

    it('should record call arguments', async () => {
      await defineTarget('writeValue');
      const mockWriteValue = await browser.electrobun.mock('writeValue');

      await callTarget('writeValue', 'test content');
      await mockWriteValue.update();

      expect(mockWriteValue).toHaveBeenCalledTimes(1);
      expect(mockWriteValue).toHaveBeenCalledWith('test content');
    });
  });

  describe('mock behaviour setters', () => {
    it('should use mockReturnValue', async () => {
      await defineTarget('readValue');
      const mockReadValue = await browser.electrobun.mock('readValue');
      await mockReadValue.mockReturnValue('mocked value');

      const result = await callTarget('readValue');
      expect(result).toBe('mocked value');
    });

    it('should use mockImplementation', async () => {
      await defineTarget('readValue');
      const mockReadValue = await browser.electrobun.mock('readValue');
      await mockReadValue.mockImplementation(() => 'impl value');

      const result = await callTarget('readValue');
      expect(result).toBe('impl value');
    });

    it('should use mockReturnValueOnce in sequence', async () => {
      await defineTarget('readValue');
      const mockReadValue = await browser.electrobun.mock('readValue');
      await mockReadValue.mockReturnValue('default');
      await mockReadValue.mockReturnValueOnce('first');
      await mockReadValue.mockReturnValueOnce('second');

      expect(await callTarget('readValue')).toBe('first');
      expect(await callTarget('readValue')).toBe('second');
      expect(await callTarget('readValue')).toBe('default');
    });

    it('should use mockResolvedValue', async () => {
      await defineTarget('fetchData');
      const mockFetchData = await browser.electrobun.mock('fetchData');
      await mockFetchData.mockResolvedValue({ ok: true });

      const result = await browser.electrobun.execute(async (_eb) =>
        (globalThis as unknown as Record<string, () => Promise<unknown>>).fetchData(),
      );
      expect(result).toEqual({ ok: true });
    });

    it('should use mockRejectedValue', async () => {
      await defineTarget('fetchData');
      const mockFetchData = await browser.electrobun.mock('fetchData');
      await mockFetchData.mockRejectedValue(new Error('connection failed'));

      const message = await browser.electrobun.execute(async (_eb) => {
        try {
          await (globalThis as unknown as Record<string, () => Promise<unknown>>).fetchData();
          return 'no error';
        } catch (e) {
          return e instanceof Error ? e.message : String(e);
        }
      });
      expect(message).toBe('connection failed');
    });
  });

  describe('browser.electrobun.clearAllMocks', () => {
    it('should clear call history without removing the mock', async () => {
      await defineTarget('readValue');
      const mockReadValue = await browser.electrobun.mock('readValue');
      await mockReadValue.mockReturnValue('still mocked');

      await callTarget('readValue');
      await mockReadValue.update();

      await browser.electrobun.clearAllMocks();

      expect(mockReadValue.mock.calls).toStrictEqual([]);
      expect(mockReadValue.mock.results).toStrictEqual([]);

      // Implementation survives a clear.
      expect(await callTarget('readValue')).toBe('still mocked');
    });
  });

  describe('browser.electrobun.resetAllMocks', () => {
    it('should clear history and remove implementations', async () => {
      await defineTarget('readValue');
      const mockReadValue = await browser.electrobun.mock('readValue');
      await mockReadValue.mockReturnValue('mocked');

      await browser.electrobun.resetAllMocks();

      expect(mockReadValue.mock.calls).toStrictEqual([]);
      const result = await callTarget('readValue');
      expect(result).toBeUndefined();
    });
  });

  describe('browser.electrobun.restoreAllMocks', () => {
    it('should restore the original implementation', async () => {
      await defineTarget('readValue');
      const mockReadValue = await browser.electrobun.mock('readValue');
      await mockReadValue.mockReturnValue('mocked');

      await browser.electrobun.restoreAllMocks();

      const result = (await callTarget('readValue')) as { real?: boolean };
      expect(result?.real).toBe(true);
    });
  });

  describe('browser.electrobun.isMockFunction', () => {
    it('should return true for a mocked target', async () => {
      await defineTarget('readValue');
      void (await browser.electrobun.mock('readValue'));

      expect(await browser.electrobun.isMockFunction('readValue')).toBe(true);
    });

    it('should return false for a non-mocked target', async () => {
      expect(await browser.electrobun.isMockFunction('not_mocked_fn')).toBe(false);
    });
  });

  describe('mock object functionality', () => {
    it('should set and get the mock name', async () => {
      await defineTarget('readValue');
      const mockReadValue = await browser.electrobun.mock('readValue');

      expect(mockReadValue.getMockName()).toBe('electrobun.readValue');

      mockReadValue.mockName('my mock');
      expect(mockReadValue.getMockName()).toBe('my mock');
    });

    it('should clear an individual mock', async () => {
      await defineTarget('readValue');
      const mockReadValue = await browser.electrobun.mock('readValue');
      await mockReadValue.mockReturnValue('mocked');

      await callTarget('readValue');
      await callTarget('readValue');

      await mockReadValue.update();
      await mockReadValue.mockClear();

      expect(mockReadValue.mock.calls).toStrictEqual([]);
      expect(mockReadValue.mock.results).toStrictEqual([]);
    });

    it('should expose recorded results after update', async () => {
      await defineTarget('readValue');
      const mockReadValue = await browser.electrobun.mock('readValue');
      await mockReadValue.mockImplementation(() => 'result');

      await callTarget('readValue');
      await mockReadValue.update();

      expect(mockReadValue.mock.results).toStrictEqual([{ type: 'return', value: 'result' }]);
    });

    it('should record invocation order across mocks', async () => {
      await defineTarget('readValue');
      await defineTarget('getValue');
      const mockReadValue = await browser.electrobun.mock('readValue');
      const mockGetValue = await browser.electrobun.mock('getValue');

      await callTarget('readValue');
      await callTarget('getValue');
      await callTarget('readValue');

      await mockReadValue.update();
      await mockGetValue.update();

      const first = mockReadValue.mock.invocationCallOrder[0];
      expect(mockReadValue.mock.invocationCallOrder).toStrictEqual([first, first + 2]);
      expect(mockGetValue.mock.invocationCallOrder).toStrictEqual([first + 1]);
    });
  });
});
