import { isAsyncFunction } from 'node:util/types';
import type { ElectronInterface, ElectronType } from '@wdio/native-types';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { createElectronBrowserModeMock, createMock } from '../src/mock.js';
import mockStore from '../src/mockStore.js';

let mockFn: Mock;
let mockExecute: Mock;

vi.doMock('@wdio/native-spy', () => ({
  fn: (_impl: unknown, options?: { original?: (...args: unknown[]) => unknown }) => {
    if (options?.original) {
      const originalFn = options.original;
      mockFn.mockRestore = vi.fn(function () {
        mockFn.mockClear();
        mockFn.mockImplementation(originalFn);
        return mockFn;
      }) as unknown as typeof mockFn.mockRestore;
    }
    return mockFn;
  },
}));

type ElectronMockExecuteFn = (
  electron: Partial<ElectronType>,
  apiName: string,
  funcName: string,
  ...additionalArgs: unknown[]
) => void;
type ElectronObj = Partial<Omit<ElectronType[ElectronInterface], 'on'>>;
type ExecuteCalls = [
  executeFn: ElectronMockExecuteFn,
  apiName: string,
  funcName: string,
  ...additionalArgs: unknown[],
][];

async function processExecuteCalls(electron: ElectronObj) {
  const executeCalls = (globalThis.browser.electron.execute as Mock).mock.calls as ExecuteCalls;
  const asyncExecuteCalls = executeCalls.filter(([executeFn]) => isAsyncFunction(executeFn));
  const syncExecuteCalls = executeCalls.filter(([executeFn]) => !isAsyncFunction(executeFn));

  // clear the mock
  (globalThis.browser.electron.execute as Mock).mockClear();

  // process sync calls
  for (const executeCall of syncExecuteCalls) {
    const [executeFn, apiName, funcName, ...additionalArgs] = executeCall;
    executeFn(electron, apiName, funcName, ...additionalArgs);
  }

  // process async calls
  return asyncExecuteCalls.length > 0
    ? Promise.all(
        asyncExecuteCalls.map(([executeFn, apiName, funcName, ...additionalArgs]) =>
          executeFn(electron, apiName, funcName, ...additionalArgs),
        ),
      )
    : Promise.resolve();
}

beforeEach(() => {
  mockFn = vi.fn();
  mockExecute = vi.fn();
  globalThis.browser = {
    electron: {
      execute: mockExecute,
    },
  } as unknown as WebdriverIO.Browser;
});

describe('Mock API', () => {
  describe('createMock()', () => {
    it('should create a mock with the expected name', async () => {
      const mock = await createMock('app', 'getName');

      expect(mock.getMockName()).toBe('electron.app.getName');
    });

    it('should create a mock with the expected methods', async () => {
      const mock = await createMock('app', 'getName');

      expect(mock.mockImplementation).toStrictEqual(expect.any(Function));
      expect(mock.mockImplementationOnce).toStrictEqual(expect.any(Function));
      expect(mock.mockReturnValue).toStrictEqual(expect.any(Function));
      expect(mock.mockReturnValueOnce).toStrictEqual(expect.any(Function));
      expect(mock.mockResolvedValue).toStrictEqual(expect.any(Function));
      expect(mock.mockResolvedValueOnce).toStrictEqual(expect.any(Function));
      expect(mock.mockRejectedValue).toStrictEqual(expect.any(Function));
      expect(mock.mockRejectedValueOnce).toStrictEqual(expect.any(Function));
      expect(mock.mockClear).toStrictEqual(expect.any(Function));
      expect(mock.mockReset).toStrictEqual(expect.any(Function));
      expect(mock.mockRestore).toStrictEqual(expect.any(Function));
      expect(mock.update).toStrictEqual(expect.any(Function));
    });

    it('should initialise the inner mock', async () => {
      await createMock('app', 'getName');
      const electron = { app: { getName: () => 'actual name' } as Omit<ElectronType['app'], 'on'> };
      await processExecuteCalls(electron);

      expect(electron.app.getName).toStrictEqual(expect.anyMockFunction());
    });

    describe('update', () => {
      it('should update according to the status of the inner mock', async () => {
        const mock = await createMock('app', 'getFileIcon');
        mockExecute.mockImplementation((fn, apiName, funcName) => {
          return fn(
            {
              app: {
                getFileIcon: {
                  mock: {
                    calls: [['/path/to/another/icon', { size: 'small' }]],
                  },
                },
              },
            },
            apiName,
            funcName,
          );
        });
        await mock.update();
        const returnedMock = mock as unknown as Mock;

        expect(returnedMock).toHaveBeenCalledTimes(1);
        expect(returnedMock).toHaveBeenCalledWith('/path/to/another/icon', { size: 'small' });
      });

      it('should update according to the empty calls', async () => {
        const mock = await createMock('app', 'getFileIcon');
        mockExecute.mockImplementation((fn, apiName, funcName) => {
          return fn(
            {
              app: {
                getFileIcon: {},
              },
            },
            apiName,
            funcName,
          );
        });
        await mock.update();
        const returnedMock = mock as unknown as Mock;

        expect(returnedMock).toHaveBeenCalledTimes(0);
      });
    });

    describe('mockImplementation', () => {
      it('should set mockImplementation of the inner mock', async () => {
        const mock = await createMock('app', 'getName');
        const electron = { app: { getName: () => 'actual name' } as Omit<ElectronType['app'], 'on'> };
        await processExecuteCalls(electron);
        await mock.mockImplementation(() => 'mock implementation');
        await processExecuteCalls(electron);

        expect(electron.app.getName()).toBe('mock implementation');
      });
    });

    describe('mockImplementationOnce', () => {
      it('should set mockImplementationOnce of the inner mock', async () => {
        const mock = await createMock('app', 'getName');
        const electron = { app: { getName: () => 'actual name' } as Omit<ElectronType['app'], 'on'> };
        await processExecuteCalls(electron);
        await mock.mockImplementation(() => 'default mock implementation');
        await mock.mockImplementationOnce(() => 'first mock implementation');
        await mock.mockImplementationOnce(() => 'second mock implementation');
        await processExecuteCalls(electron);

        expect(electron.app.getName()).toBe('first mock implementation');
        expect(electron.app.getName()).toBe('second mock implementation');
        expect(electron.app.getName()).toBe('default mock implementation');
        expect(electron.app.getName()).toBe('default mock implementation');
      });
    });

    describe('mockReturnValue', () => {
      it('should set mockReturnValue of the inner mock', async () => {
        const mock = await createMock('app', 'getName');
        const electron = { app: { getName: () => 'actual name' } as Omit<ElectronType['app'], 'on'> };
        await processExecuteCalls(electron);
        await mock.mockReturnValue('mock return value');
        await processExecuteCalls(electron);

        expect(electron.app.getName()).toBe('mock return value');
      });
    });

    describe('mockReturnValueOnce', () => {
      it('should set mockReturnValueOnce of the inner mock', async () => {
        const mock = await createMock('app', 'getName');
        const electron = { app: { getName: () => 'actual name' } as Omit<ElectronType['app'], 'on'> };
        await processExecuteCalls(electron);
        await mock.mockReturnValue('default mock return value');
        await mock.mockReturnValueOnce('first mock return value');
        await mock.mockReturnValueOnce('second mock return value');
        await processExecuteCalls(electron);

        expect(electron.app.getName()).toBe('first mock return value');
        expect(electron.app.getName()).toBe('second mock return value');
        expect(electron.app.getName()).toBe('default mock return value');
      });
    });

    describe('mockResolvedValue', () => {
      it('should set mockResolvedValue of the inner mock', async () => {
        const mock = await createMock('app', 'getFileIcon');
        const electron = {
          app: { getFileIcon: () => Promise.resolve('actual fileIcon') } as unknown as Omit<ElectronType['app'], 'on'>,
        };
        await processExecuteCalls(electron);
        await mock.mockResolvedValue('mock resolved value');
        await processExecuteCalls(electron);

        expect(await electron.app.getFileIcon('/path/to/icon')).toBe('mock resolved value');
      });
    });

    describe('mockResolvedValueOnce', () => {
      it('should set mockResolvedValueOnce of the inner mock', async () => {
        const mock = await createMock('app', 'getFileIcon');
        const electron = {
          app: { getFileIcon: () => Promise.resolve('actual fileIcon') } as unknown as Omit<ElectronType['app'], 'on'>,
        };
        await processExecuteCalls(electron);
        await mock.mockResolvedValue('default mock resolved value');
        await mock.mockResolvedValueOnce('first mock resolved value');
        await mock.mockResolvedValueOnce('second mock resolved value');
        await processExecuteCalls(electron);

        expect(await electron.app.getFileIcon('/path/to/icon')).toBe('first mock resolved value');
        expect(await electron.app.getFileIcon('/path/to/icon')).toBe('second mock resolved value');
        expect(await electron.app.getFileIcon('/path/to/icon')).toBe('default mock resolved value');
      });
    });

    describe('mockRejectedValue', () => {
      it('should set mockRejectedValue of the inner mock', async () => {
        const mock = await createMock('app', 'getFileIcon');
        const electron = {
          app: { getFileIcon: () => Promise.resolve('actual fileIcon') } as unknown as Omit<ElectronType['app'], 'on'>,
        };
        await processExecuteCalls(electron);
        await mock.mockRejectedValue('mock rejected value');
        await processExecuteCalls(electron);

        await expect(() => electron.app.getFileIcon('/path/to/icon')).rejects.toThrow('mock rejected value');
      });
    });

    describe('mockRejectedValueOnce', () => {
      it('should set mockRejectedValueOnce of the inner mock', async () => {
        const mock = await createMock('app', 'getFileIcon');
        const electron = {
          app: { getFileIcon: () => Promise.resolve('actual fileIcon') } as unknown as Omit<ElectronType['app'], 'on'>,
        };
        await processExecuteCalls(electron);
        await mock.mockRejectedValue('default mock rejected value');
        await mock.mockRejectedValueOnce('first mock rejected value');
        await mock.mockRejectedValueOnce('second mock rejected value');
        await processExecuteCalls(electron);

        await expect(electron.app.getFileIcon('/path/to/icon')).rejects.toThrow('first mock rejected value');
        await expect(electron.app.getFileIcon('/path/to/icon')).rejects.toThrow('second mock rejected value');
        await expect(electron.app.getFileIcon('/path/to/icon')).rejects.toThrow('default mock rejected value');
      });
    });

    describe('mockClear', () => {
      it('should clear the inner mock', async () => {
        const mock = await createMock('app', 'getName');
        const electron = {
          app: { getName: () => 'actual name' } as unknown as Omit<ElectronType['app'], 'on'>,
        };
        await processExecuteCalls(electron);

        electron.app.getName();
        electron.app.getName();
        electron.app.getName();

        expect((electron.app.getName as Mock).mock.calls).toStrictEqual([[], [], []]);

        await mock.mockClear();
        await processExecuteCalls(electron);

        expect((electron.app.getName as Mock).mock.calls).toStrictEqual([]);
      });
    });

    describe('mockReset', () => {
      it('should reset the inner mock', async () => {
        const mock = await createMock('app', 'getName');
        const electron = {
          app: { getName: () => 'actual name' } as unknown as Omit<ElectronType['app'], 'on'>,
        };
        await processExecuteCalls(electron);
        await mock.mockImplementation(() => 'mocked name');
        await processExecuteCalls(electron);

        expect(electron.app.getName()).toBe('mocked name');
        expect((electron.app.getName as Mock).mock.calls).toStrictEqual([[]]);

        await mock.mockReset();
        await processExecuteCalls(electron);

        expect(electron.app.getName()).toBeUndefined();
        expect((electron.app.getName as Mock).mock.calls).toStrictEqual([[]]);
      });
    });

    describe('mockRestore', () => {
      it('should restore the inner mock', async () => {
        const mock = await createMock('app', 'getName');
        const electron = {
          app: { getName: () => 'actual name' } as unknown as Omit<ElectronType['app'], 'on'>,
        };
        globalThis.originalApi = {
          app: { getName: () => 'actual name' },
        } as ElectronType;
        await processExecuteCalls(electron);

        expect(electron.app.getName()).toBeUndefined();
        expect((electron.app.getName as Mock).mock.calls).toStrictEqual([[]]);

        await mock.mockRestore();
        await processExecuteCalls(electron);

        expect(electron.app.getName()).toBe('actual name');
      });
    });

    describe('mockReturnThis', () => {
      it('should allow chaining', async () => {
        const mock = await createMock('app', 'getName');
        const electron = {
          app: { getName: () => 'actual name', getVersion: () => 'actual version' } as unknown as Omit<
            ElectronType['app'],
            'on'
          >,
        };
        await processExecuteCalls(electron);
        await mock.mockReturnThis();
        await processExecuteCalls(electron);

        expect((electron.app.getName() as unknown as Omit<ElectronType['app'], 'on'>).getVersion()).toBe(
          'actual version',
        );
      });
    });

    describe('withImplementation', () => {
      it('should temporarily override mock implementation with sync callback', async () => {
        const mock = await createMock('app', 'getName');
        const electron = {
          app: { getName: () => 'actual name' } as unknown as Omit<ElectronType['app'], 'on'>,
        };
        await processExecuteCalls(electron);
        await mock.withImplementation(
          () => 'temporary name',
          (electron) => electron.app.getName(),
        );
        const executeResults = await processExecuteCalls(electron);

        expect(executeResults).toStrictEqual(['temporary name']);
      });

      it('should temporarily override mock implementation with async callback', async () => {
        const mock = await createMock('app', 'getName');
        const electron = {
          app: { getName: () => 'actual name' } as unknown as Omit<ElectronType['app'], 'on'>,
        };
        await processExecuteCalls(electron);
        await mock.withImplementation(
          () => 'temporary name',
          async (electron) => electron.app.getName(),
        );
        const executeResults = await processExecuteCalls(electron);

        expect(executeResults).toStrictEqual(['temporary name']);
      });
    });
  });
});

describe('createElectronBrowserModeMock()', () => {
  let mockBrowser: { execute: Mock; executeAsync: Mock };

  beforeEach(() => {
    mockBrowser = {
      execute: vi.fn().mockResolvedValue(undefined),
      executeAsync: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    mockStore.clear();
  });

  function makeCallData(
    calls: unknown[][] = [],
    results: { type: string; value: unknown }[] = [],
    invocationCallOrder: number[] = [],
  ) {
    return { calls, results, invocationCallOrder };
  }

  it('should create a mock with the expected name', async () => {
    const mock = await createElectronBrowserModeMock('get-user-data', mockBrowser as unknown as WebdriverIO.Browser);
    expect(mock.getMockName()).toBe('electron.get-user-data');
  });

  it('should set __isElectronMock to true', async () => {
    const mock = await createElectronBrowserModeMock('my-channel', mockBrowser as unknown as WebdriverIO.Browser);
    expect(mock.__isElectronMock).toBe(true);
  });

  it('should call browser.execute once during construction to register the channel', async () => {
    await createElectronBrowserModeMock('my-channel', mockBrowser as unknown as WebdriverIO.Browser);
    expect(mockBrowser.execute).toHaveBeenCalledTimes(1);
  });

  describe('update()', () => {
    it('should populate mock.calls from browser-side call data', async () => {
      const mock = await createElectronBrowserModeMock('get-user', mockBrowser as unknown as WebdriverIO.Browser);
      mockBrowser.execute.mockResolvedValueOnce(
        makeCallData(
          [['alice'], ['bob']],
          [
            { type: 'return', value: 1 },
            { type: 'return', value: 2 },
          ],
          [1, 2],
        ),
      );

      await mock.update();

      expect(mock.mock.calls).toStrictEqual([['alice'], ['bob']]);
      expect(mock.mock.results).toStrictEqual([
        { type: 'return', value: 1 },
        { type: 'return', value: 2 },
      ]);
      expect(mock.mock.invocationCallOrder).toStrictEqual([1, 2]);
    });

    it('should fully replace existing calls — reset+same-count does not silently skip', async () => {
      const mock = await createElectronBrowserModeMock('get-user', mockBrowser as unknown as WebdriverIO.Browser);

      // First sync: 2 calls with old arguments
      mockBrowser.execute.mockResolvedValueOnce(
        makeCallData(
          [['old-a'], ['old-b']],
          [
            { type: 'return', value: 'old1' },
            { type: 'return', value: 'old2' },
          ],
          [1, 2],
        ),
      );
      await mock.update();
      expect(mock.mock.calls).toStrictEqual([['old-a'], ['old-b']]);

      // Browser was cleared and re-invoked the same number of times with different args
      mockBrowser.execute.mockResolvedValueOnce(
        makeCallData(
          [['new-a'], ['new-b']],
          [
            { type: 'return', value: 'new1' },
            { type: 'return', value: 'new2' },
          ],
          [3, 4],
        ),
      );
      await mock.update();

      // Must replace, not keep stale calls
      expect(mock.mock.calls).toStrictEqual([['new-a'], ['new-b']]);
      expect(mock.mock.invocationCallOrder).toStrictEqual([3, 4]);
    });

    it('should clear outer mock when browser reports zero calls', async () => {
      const mock = await createElectronBrowserModeMock('get-user', mockBrowser as unknown as WebdriverIO.Browser);

      mockBrowser.execute.mockResolvedValueOnce(makeCallData([['arg']], [{ type: 'return', value: 'v' }], [1]));
      await mock.update();
      expect(mock.mock.calls).toHaveLength(1);

      mockBrowser.execute.mockResolvedValueOnce(makeCallData());
      await mock.update();

      expect(mock.mock.calls).toHaveLength(0);
      expect(mock.mock.results).toHaveLength(0);
      expect(mock.mock.invocationCallOrder).toHaveLength(0);
    });

    it('should handle missing results gracefully by substituting a default result', async () => {
      const mock = await createElectronBrowserModeMock('get-user', mockBrowser as unknown as WebdriverIO.Browser);
      mockBrowser.execute.mockResolvedValueOnce({ calls: [['arg']], results: [], invocationCallOrder: [1] });

      await mock.update();

      expect(mock.mock.results).toStrictEqual([{ type: 'return', value: undefined }]);
    });
  });

  describe('mockClear()', () => {
    it('should clear call history on both browser-side and outer mock', async () => {
      const mock = await createElectronBrowserModeMock('my-channel', mockBrowser as unknown as WebdriverIO.Browser);
      mockBrowser.execute.mockResolvedValueOnce(makeCallData([['arg']], [{ type: 'return', value: 1 }], [1]));
      await mock.update();
      expect(mock.mock.calls).toHaveLength(1);

      await mock.mockClear();

      expect(mock.mock.calls).toHaveLength(0);
    });
  });

  describe('__replayBrowserImpl()', () => {
    it('should do nothing and make no execute call when no impl has been set', async () => {
      const mock = await createElectronBrowserModeMock('my-channel', mockBrowser as unknown as WebdriverIO.Browser);
      const callsBefore = mockBrowser.execute.mock.calls.length;

      const replay = (mock as unknown as Record<string, () => Promise<void>>).__replayBrowserImpl;
      await replay();

      expect(mockBrowser.execute.mock.calls.length).toBe(callsBefore);
    });

    it('should re-apply mockReturnValue after navigation by running the inner setter script', async () => {
      const mock = await createElectronBrowserModeMock('my-channel', mockBrowser as unknown as WebdriverIO.Browser);
      await mock.mockReturnValue('initial');
      const callsBefore = mockBrowser.execute.mock.calls.length;

      const replay = (mock as unknown as Record<string, () => Promise<void>>).__replayBrowserImpl;
      await replay();

      expect(mockBrowser.execute.mock.calls.length).toBe(callsBefore + 1);
      const replayScript = mockBrowser.execute.mock.calls[callsBefore][0] as string;
      expect(replayScript).toContain('mockReturnValue');
    });

    it('should re-apply mockResolvedValue after navigation', async () => {
      const mock = await createElectronBrowserModeMock('my-channel', mockBrowser as unknown as WebdriverIO.Browser);
      await mock.mockResolvedValue('resolved');
      const callsBefore = mockBrowser.execute.mock.calls.length;

      const replay = (mock as unknown as Record<string, () => Promise<void>>).__replayBrowserImpl;
      await replay();

      const replayScript = mockBrowser.execute.mock.calls[callsBefore][0] as string;
      expect(replayScript).toContain('mockResolvedValue');
    });

    it('should re-apply mockRejectedValue after navigation', async () => {
      const mock = await createElectronBrowserModeMock('my-channel', mockBrowser as unknown as WebdriverIO.Browser);
      await mock.mockRejectedValue(new Error('boom'));
      const callsBefore = mockBrowser.execute.mock.calls.length;

      const replay = (mock as unknown as Record<string, () => Promise<void>>).__replayBrowserImpl;
      await replay();

      const replayScript = mockBrowser.execute.mock.calls[callsBefore][0] as string;
      expect(replayScript).toContain('mockRejectedValue');
    });

    it('should re-apply mockImplementation after navigation', async () => {
      const mock = await createElectronBrowserModeMock('my-channel', mockBrowser as unknown as WebdriverIO.Browser);
      await mock.mockImplementation(() => 'test-impl');
      const callsBefore = mockBrowser.execute.mock.calls.length;

      const replay = (mock as unknown as Record<string, () => Promise<void>>).__replayBrowserImpl;
      await replay();

      expect(mockBrowser.execute.mock.calls.length).toBe(callsBefore + 1);
    });

    it('should re-apply mockReturnThis after navigation', async () => {
      const mock = await createElectronBrowserModeMock('my-channel', mockBrowser as unknown as WebdriverIO.Browser);
      await mock.mockReturnThis();
      const callsBefore = mockBrowser.execute.mock.calls.length;

      const replay = (mock as unknown as Record<string, () => Promise<void>>).__replayBrowserImpl;
      await replay();

      expect(mockBrowser.execute.mock.calls.length).toBe(callsBefore + 1);
      const replayScript = mockBrowser.execute.mock.calls[callsBefore][0] as string;
      expect(replayScript).toContain('mockReturnThis');
    });

    it('should replay the latest setter when multiple have been called (last one wins)', async () => {
      const mock = await createElectronBrowserModeMock('my-channel', mockBrowser as unknown as WebdriverIO.Browser);
      await mock.mockReturnValue('first');
      await mock.mockResolvedValue('last');
      const callsBefore = mockBrowser.execute.mock.calls.length;

      const replay = (mock as unknown as Record<string, () => Promise<void>>).__replayBrowserImpl;
      await replay();

      const replayScript = mockBrowser.execute.mock.calls[callsBefore][0] as string;
      expect(replayScript).toContain('mockResolvedValue');
      expect(replayScript).not.toContain('mockReturnValue');
    });

    it('should do nothing after mockReset() clears the impl state', async () => {
      const mock = await createElectronBrowserModeMock('my-channel', mockBrowser as unknown as WebdriverIO.Browser);
      await mock.mockReturnValue('value');
      await mock.mockReset();
      const callsBefore = mockBrowser.execute.mock.calls.length;

      const replay = (mock as unknown as Record<string, () => Promise<void>>).__replayBrowserImpl;
      await replay();

      expect(mockBrowser.execute.mock.calls.length).toBe(callsBefore);
    });

    it('should do nothing after mockRestore() clears the impl state', async () => {
      const mock = await createElectronBrowserModeMock('my-channel', mockBrowser as unknown as WebdriverIO.Browser);
      await mock.mockResolvedValue('value');
      await mock.mockRestore();
      const callsBefore = mockBrowser.execute.mock.calls.length;

      const replay = (mock as unknown as Record<string, () => Promise<void>>).__replayBrowserImpl;
      await replay();

      expect(mockBrowser.execute.mock.calls.length).toBe(callsBefore);
    });
  });

  describe('withImplementation()', () => {
    it('should call mock.update() after the browser callback so call data is synced to the outer mock', async () => {
      const mock = await createElectronBrowserModeMock('my-channel', mockBrowser as unknown as WebdriverIO.Browser);

      mockBrowser.executeAsync.mockResolvedValueOnce('callback-result');
      mockBrowser.execute.mockResolvedValueOnce(
        makeCallData([['arg']], [{ type: 'return', value: 'callback-result' }], [1]),
      );

      await mock.withImplementation(
        () => 'impl',
        () => undefined,
      );

      expect(mock.mock.calls).toStrictEqual([['arg']]);
    });

    it('throws when the browser-side callback fails', async () => {
      const mock = await createElectronBrowserModeMock('err-channel', mockBrowser as unknown as WebdriverIO.Browser);

      mockBrowser.executeAsync.mockResolvedValueOnce({ __wdioAsyncErr__: 'boom' });

      await expect(
        mock.withImplementation(
          () => undefined,
          () => undefined,
        ),
      ).rejects.toThrow('boom');
    });
  });

  describe('mockRestore()', () => {
    it('should keep the mock in the store — channel must remain registered for restoreMocks: true to be safe across tests', async () => {
      const mock = await createElectronBrowserModeMock('my-channel', mockBrowser as unknown as WebdriverIO.Browser);
      const storeKey = 'electron.my-channel\x000';
      mockStore.setMockWithKey(storeKey, mock as unknown as Parameters<typeof mockStore.setMockWithKey>[1]);

      await mock.mockRestore();

      expect(mockStore.getMock(storeKey)).toBe(mock);
    });

    it('should clear the outer mock call history on restore', async () => {
      const mock = await createElectronBrowserModeMock('my-channel', mockBrowser as unknown as WebdriverIO.Browser);
      mockBrowser.execute.mockResolvedValueOnce(makeCallData([['arg']], [{ type: 'return', value: 1 }], [1]));
      await mock.update();
      expect(mock.mock.calls).toHaveLength(1);

      await mock.mockRestore();

      expect(mock.mock.calls).toHaveLength(0);
    });

    it('should preserve the mock name across restore', async () => {
      const mock = await createElectronBrowserModeMock('my-channel', mockBrowser as unknown as WebdriverIO.Browser);

      await mock.mockRestore();

      expect(mock.getMockName()).toBe('electron.my-channel');
    });
  });
});
