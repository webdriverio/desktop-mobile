import type { BrowserExtension } from '@wdio/native-types';
import { waitUntilWindowAvailable } from '@wdio/native-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllMocks } from '../src/commands/clearAllMocks.js';
import { execute } from '../src/commands/executeCdp.js';
import { isMockFunction } from '../src/commands/isMockFunction.js';
import { mock } from '../src/commands/mock.js';
import { mockAll } from '../src/commands/mockAll.js';
import { resetAllMocks } from '../src/commands/resetAllMocks.js';
import { restoreAllMocks } from '../src/commands/restoreAllMocks.js';
import mockStore from '../src/mockStore.js';
import ElectronWorkerService, { browserModeStoreKey } from '../src/service.js';
import { clearPuppeteerSessions, ensureActiveWindowFocus } from '../src/window.js';
import { mockProcessProperty } from './helpers.js';

const commands = {
  clearAllMocks,
  isMockFunction,
  mock,
  mockAll,
  resetAllMocks,
  restoreAllMocks,
};

vi.mock('@wdio/native-utils', () => import('./mocks/native-utils.js'));

vi.mock('../src/window.js', () => {
  return {
    getActiveWindowHandle: vi.fn(),
    ensureActiveWindowFocus: vi.fn(),
    getPuppeteer: vi.fn(),
    clearPuppeteerSessions: vi.fn(),
  };
});

vi.mock('../src/commands/isMockFunction.js', () => ({ isMockFunction: vi.fn() }));
vi.mock('../src/commands/mock.js', () => ({ mock: vi.fn() }));
vi.mock('../src/commands/mockAll.js', () => ({ mockAll: vi.fn() }));
vi.mock('../src/commands/clearAllMocks.js', () => ({ clearAllMocks: vi.fn() }));
vi.mock('../src/commands/resetAllMocks.js', () => ({ resetAllMocks: vi.fn() }));
vi.mock('../src/commands/restoreAllMocks.js', () => ({ restoreAllMocks: vi.fn() }));

vi.mock('../src/commands/executeCdp', () => {
  return {
    execute: vi.fn(),
  };
});

vi.mock('../src/bridge', () => {
  const ElectronCdpBridge = vi.fn();
  ElectronCdpBridge.prototype.connect = vi.fn();
  ElectronCdpBridge.prototype.send = vi.fn();
  ElectronCdpBridge.prototype.on = vi.fn();
  return {
    getDebuggerEndpoint: vi.fn(),
    ElectronCdpBridge,
  };
});

vi.mock('../src/fuses', () => {
  return {
    checkInspectFuse: vi.fn().mockResolvedValue({ canUseCdpBridge: true }),
  };
});

vi.mock('../src/mockStore', () => {
  return {
    default: {
      getMocks: vi.fn().mockReturnValue([]),
      setMock: vi.fn(),
      getMock: vi.fn().mockImplementation(() => {
        throw new Error('No mock registered for key');
      }),
      setMockWithKey: vi.fn(),
      clear: vi.fn(),
    },
  };
});

vi.mock('../src/mock.js', () => ({
  createElectronBrowserModeMock: vi.fn().mockResolvedValue({ __isElectronMock: true }),
}));

vi.mock('../src/logCapture', () => {
  return {
    LogCaptureManager: vi.fn().mockImplementation(() => ({
      captureMainProcessLogs: vi.fn().mockResolvedValue(undefined),
      captureRendererLogs: vi.fn().mockResolvedValue(undefined),
      stopCapture: vi.fn(),
    })),
  };
});

let instance: ElectronWorkerService | undefined;

beforeEach(async () => {
  mockProcessProperty('platform', 'darwin');
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  vi.mocked(waitUntilWindowAvailable).mockImplementation(async () => Promise.resolve());
});

describe('Electron Worker Service', () => {
  let browser: WebdriverIO.Browser;

  describe('before()', () => {
    beforeEach(() => {
      vi.clearAllMocks();

      browser = {
        sessionId: 'dummyId',
        waitUntil: vi.fn().mockImplementation(async (condition) => {
          await condition();
        }),
        execute: vi.fn().mockImplementation((fn) => fn()),
        getWindowHandles: vi.fn().mockResolvedValue(['dummy']),
        switchToWindow: vi.fn(),
        getPuppeteer: vi.fn(),
        overwriteCommand: vi.fn(),
        electron: {}, // Let the service initialize this
      } as unknown as WebdriverIO.Browser;
    });

    it('should initialize CDP bridge and add all electron commands to the browser object', async () => {
      instance = new ElectronWorkerService({}, {});

      await instance.before({}, [], browser);

      const { getDebuggerEndpoint, ElectronCdpBridge } = await import('../src/bridge.js');
      expect(getDebuggerEndpoint).toHaveBeenCalled();
      expect(ElectronCdpBridge).toHaveBeenCalled();

      const serviceApi = browser.electron as BrowserExtension['electron'];
      expect(serviceApi.clearAllMocks).toEqual(expect.any(Function));
      expect(serviceApi.execute).toEqual(expect.any(Function));
      expect(serviceApi.isMockFunction).toEqual(expect.any(Function));
      expect(serviceApi.mock).toEqual(expect.any(Function));
      expect(serviceApi.mockAll).toEqual(expect.any(Function));
      expect(serviceApi.resetAllMocks).toEqual(expect.any(Function));
      expect(serviceApi.restoreAllMocks).toEqual(expect.any(Function));
      expect(serviceApi.triggerDeeplink).toEqual(expect.any(Function));
      expect(serviceApi.emitEvent).toEqual(expect.any(Function));
    });

    it('should route emitEvent through electron.execute in native mode', async () => {
      instance = new ElectronWorkerService({}, {});
      await instance.before({}, [], browser);
      const serviceApi = browser.electron as BrowserExtension['electron'];

      await serviceApi.emitEvent('did-update-info', { count: 3 }, 'extra');

      const executeMock = vi.mocked(await import('../src/commands/executeCdp.js')).execute;
      expect(executeMock).toHaveBeenCalled();
      const lastCall = executeMock.mock.calls[executeMock.mock.calls.length - 1];
      // [browser, cdpBridge, fn, channel, args]
      expect(typeof lastCall[2]).toBe('function');
      expect(lastCall[3]).toBe('did-update-info');
      expect(lastCall[4]).toEqual([{ count: 3 }, 'extra']);
    });

    it('should provide a stubbed API when CDP bridge is unavailable', async () => {
      // Mock the CDP bridge initialization to fail
      const { checkInspectFuse } = await import('../src/fuses.js');
      vi.mocked(checkInspectFuse).mockResolvedValueOnce({ canUseCdpBridge: false });

      instance = new ElectronWorkerService({}, {});

      // Provide capabilities with a binary path to trigger the fuse check
      const capabilities = {
        'goog:chromeOptions': {
          binary: '/path/to/electron',
        },
      };

      await instance.before(capabilities, [], browser);

      const serviceApi = browser.electron as BrowserExtension['electron'];
      expect(serviceApi.clearAllMocks).toEqual(expect.any(Function));
      expect(serviceApi.execute).toEqual(expect.any(Function));
      expect(serviceApi.mock).toEqual(expect.any(Function));
      expect(serviceApi.mockAll).toEqual(expect.any(Function));
      expect(serviceApi.resetAllMocks).toEqual(expect.any(Function));
      expect(serviceApi.restoreAllMocks).toEqual(expect.any(Function));

      // triggerDeeplink does not require CDP, so it should not throw
      expect(() => serviceApi.triggerDeeplink).not.toThrow();

      // Test that CDP-dependent methods throw appropriate errors
      expect(() => serviceApi.execute(() => {})).toThrow('CDP bridge is not available, API is disabled');
      expect(() => serviceApi.clearAllMocks()).toThrow('CDP bridge is not available, API is disabled');
      expect(() => serviceApi.isMockFunction(() => {})).toThrow('CDP bridge is not available, API is disabled');
      expect(() => serviceApi.mock('app', 'getName')).toThrow('CDP bridge is not available, API is disabled');
      expect(() => serviceApi.mockAll('app')).toThrow('CDP bridge is not available, API is disabled');
      expect(() => serviceApi.resetAllMocks()).toThrow('CDP bridge is not available, API is disabled');
      expect(() => serviceApi.restoreAllMocks()).toThrow('CDP bridge is not available, API is disabled');
    });

    it('should gracefully degrade when CDP bridge connection fails', async () => {
      const { ElectronCdpBridge } = await import('../src/bridge.js');
      vi.mocked(ElectronCdpBridge.prototype.connect).mockRejectedValueOnce(new Error('Connection refused'));

      instance = new ElectronWorkerService({}, {});
      await instance.before({}, [], browser);

      const serviceApi = browser.electron as BrowserExtension['electron'];
      expect(() => serviceApi.execute(() => {})).toThrow('CDP bridge is not available, API is disabled');
      expect(() => serviceApi.mock('app', 'getName')).toThrow('CDP bridge is not available, API is disabled');
    });

    it('should log warning when fuse check has non-fatal error', async () => {
      const { checkInspectFuse } = await import('../src/fuses.js');
      vi.mocked(checkInspectFuse).mockResolvedValueOnce({
        canUseCdpBridge: true,
        error: 'Could not read fuse config, proceeding anyway',
      });

      instance = new ElectronWorkerService({}, {});
      const capabilities = {
        'goog:chromeOptions': {
          binary: '/path/to/electron',
        },
      };
      await instance.before(capabilities, [], browser);

      const serviceApi = browser.electron as BrowserExtension['electron'];
      expect(serviceApi.execute).toEqual(expect.any(Function));
    });

    it('should reject when waitUntilWindowAvailable fails', async () => {
      // Mock the @wdio/native-utils version which the service actually calls
      const nativeUtils = await import('@wdio/native-utils');
      vi.mocked(nativeUtils.waitUntilWindowAvailable).mockRejectedValueOnce(new Error('Window not found'));

      instance = new ElectronWorkerService({}, {});

      await expect(instance.before({}, [], browser)).rejects.toThrow('Window not found');
    });

    it('should install element command overrides with overwriteCommand', async () => {
      instance = new ElectronWorkerService({}, {});

      await instance.before({}, [], browser);

      const oc = vi.mocked((browser as any).overwriteCommand);
      const calls = oc.mock.calls;
      const overridden = calls.map((c: unknown[]) => ({ name: c[0], isElement: c[2] }));
      expect(overridden).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'click', isElement: true }),
          expect.objectContaining({ name: 'doubleClick', isElement: true }),
          expect.objectContaining({ name: 'setValue', isElement: true }),
          expect.objectContaining({ name: 'clearValue', isElement: true }),
        ]),
      );
    });

    it('should update mocks after overridden element command executes', async () => {
      instance = new ElectronWorkerService({}, {});
      await instance.before({}, [], browser);

      const storeModule = (await import('../src/mockStore.js')) as any;
      const mockObj = {
        __accessor: { kind: 'api', apiName: 'app', funcName: 'getName' },
        __applyCalls: vi.fn(),
      };
      storeModule.default.getMocks.mockReturnValueOnce([['electron.app.getName', mockObj]]);

      const oc = vi.mocked((browser as any).overwriteCommand);
      const clickCall = oc.mock.calls.find((c: unknown[]) => c[0] === 'click');
      expect(clickCall).toBeDefined();
      const overrideFn = clickCall?.[1] as unknown as (
        this: WebdriverIO.Element,
        original: (...args: unknown[]) => Promise<unknown>,
        ...args: unknown[]
      ) => Promise<unknown>;

      const original = vi.fn().mockResolvedValue('ok');
      await overrideFn?.call({} as unknown as WebdriverIO.Element, original);

      // Batched scheduler hands the read-back call data to __applyCalls; this
      // proves the override still drives mock sync after the per-mock update()
      // path was retired.
      expect(mockObj.__applyCalls).toHaveBeenCalledTimes(1);
      expect(original).toHaveBeenCalled();
    });

    it('should batch updates for ≥2 mocks into a single browser.electron.execute call', async () => {
      instance = new ElectronWorkerService({}, {});
      await instance.before({}, [], browser);

      const executeMock = vi.mocked(await import('../src/commands/executeCdp.js')).execute;
      executeMock.mockClear();
      executeMock.mockResolvedValue({});

      const storeModule = (await import('../src/mockStore.js')) as any;
      const mockA = {
        __accessor: { kind: 'api', apiName: 'app', funcName: 'getName' },
        __applyCalls: vi.fn(),
      };
      const mockB = {
        __accessor: { kind: 'prototype', className: 'Tray', methodName: 'setImage' },
        __applyCalls: vi.fn(),
      };
      const mockC = {
        __accessor: { kind: 'constructor', className: 'Tray' },
        __applyCalls: vi.fn(),
      };
      storeModule.default.getMocks.mockReturnValueOnce([
        ['electron.app.getName', mockA],
        ['electron.Tray.setImage', mockB],
        ['electron.Tray.__constructor', mockC],
      ]);

      const oc = vi.mocked((browser as any).overwriteCommand);
      const overrideFn = oc.mock.calls.find((c: unknown[]) => c[0] === 'click')?.[1] as unknown as (
        this: WebdriverIO.Element,
        original: (...args: unknown[]) => Promise<unknown>,
        ...args: unknown[]
      ) => Promise<unknown>;

      const original = vi.fn().mockResolvedValue('ok');
      await overrideFn.call({} as unknown as WebdriverIO.Element, original);

      // Acceptance criteria: one CDP round-trip regardless of mock count.
      expect(executeMock).toHaveBeenCalledTimes(1);
      // Every registered mock still receives its slice via __applyCalls.
      expect(mockA.__applyCalls).toHaveBeenCalledTimes(1);
      expect(mockB.__applyCalls).toHaveBeenCalledTimes(1);
      expect(mockC.__applyCalls).toHaveBeenCalledTimes(1);
    });

    it('should propagate per-mock __error markers from native batch to __applyCalls', async () => {
      instance = new ElectronWorkerService({}, {});
      await instance.before({}, [], browser);

      const executeMock = vi.mocked(await import('../src/commands/executeCdp.js')).execute;
      executeMock.mockClear();
      // Simulate the inner script catching a per-mock failure and emitting
      // an __error marker. The outer code log.warns it and still forwards the
      // slice to __applyCalls so the scheduler doesn't stall — empty calls
      // reaching the outer mock are the observable signal that the read failed.
      executeMock.mockResolvedValue({
        'electron.app.getName': { calls: [], results: [], __error: 'boom: app undefined' },
      });

      const storeModule = (await import('../src/mockStore.js')) as any;
      const mockObj = {
        __accessor: { kind: 'api', apiName: 'app', funcName: 'getName' },
        __applyCalls: vi.fn(),
      };
      storeModule.default.getMocks.mockReturnValueOnce([['electron.app.getName', mockObj]]);

      const oc = vi.mocked((browser as any).overwriteCommand);
      const overrideFn = oc.mock.calls.find((c: unknown[]) => c[0] === 'click')?.[1] as unknown as (
        this: WebdriverIO.Element,
        original: (...args: unknown[]) => Promise<unknown>,
        ...args: unknown[]
      ) => Promise<unknown>;
      await overrideFn.call({} as unknown as WebdriverIO.Element, vi.fn().mockResolvedValue('ok'));

      expect(mockObj.__applyCalls).toHaveBeenCalledTimes(1);
      expect(mockObj.__applyCalls).toHaveBeenCalledWith(
        expect.objectContaining({ calls: [], __error: 'boom: app undefined' }),
      );
    });

    it('should batch updates for ≥2 browser-mode mocks into a single browser.execute call', async () => {
      instance = new ElectronWorkerService({}, {});
      await instance.before({}, [], browser);

      const storeModule = (await import('../src/mockStore.js')) as any;
      const keyA = browserModeStoreKey(browser, 'ipc-a');
      const keyB = browserModeStoreKey(browser, 'ipc-b');
      const mockA = {
        __accessor: { kind: 'browser', channel: 'ipc-a' },
        __applyCalls: vi.fn(),
      };
      const mockB = {
        __accessor: { kind: 'browser', channel: 'ipc-b' },
        __applyCalls: vi.fn(),
      };

      // browser.execute is the transport for browser-mode batch reads. The
      // default `(fn) => fn()` impl from beforeEach would try to invoke our
      // return-script string as a function — swap in a resolver that yields a
      // parseable {[mockStoreKey]: {calls, results, invocationCallOrder}} map.
      const browserExecute = browser.execute as unknown as ReturnType<typeof vi.fn>;
      browserExecute.mockReset();
      browserExecute.mockResolvedValue({
        [keyA]: { calls: [['x']], results: [{ type: 'return', value: undefined }], invocationCallOrder: [1] },
        [keyB]: { calls: [['y']], results: [{ type: 'return', value: undefined }], invocationCallOrder: [2] },
      });
      storeModule.default.getMocks.mockReturnValueOnce([
        [keyA, mockA],
        [keyB, mockB],
      ]);

      const oc = vi.mocked((browser as any).overwriteCommand);
      const overrideFn = oc.mock.calls.find((c: unknown[]) => c[0] === 'click')?.[1] as unknown as (
        this: WebdriverIO.Element,
        original: (...args: unknown[]) => Promise<unknown>,
        ...args: unknown[]
      ) => Promise<unknown>;

      const original = vi.fn().mockResolvedValue('ok');
      await overrideFn.call({} as unknown as WebdriverIO.Element, original);

      expect(browserExecute).toHaveBeenCalledTimes(1);
      expect(mockA.__applyCalls).toHaveBeenCalledTimes(1);
      expect(mockB.__applyCalls).toHaveBeenCalledTimes(1);
      // parseCallData should have round-tripped the calls payload intact.
      expect(mockA.__applyCalls.mock.calls[0][0]).toMatchObject({ calls: [['x']] });
      expect(mockB.__applyCalls.mock.calls[0][0]).toMatchObject({ calls: [['y']] });
    });

    it('should split native and browser-mode mocks across exactly two round-trips', async () => {
      instance = new ElectronWorkerService({}, {});
      await instance.before({}, [], browser);

      const executeMock = vi.mocked(await import('../src/commands/executeCdp.js')).execute;
      executeMock.mockClear();
      executeMock.mockResolvedValue({});

      const browserExecute = browser.execute as unknown as ReturnType<typeof vi.fn>;
      browserExecute.mockReset();
      browserExecute.mockResolvedValue({});

      const storeModule = (await import('../src/mockStore.js')) as any;
      const nativeMock = {
        __accessor: { kind: 'api', apiName: 'app', funcName: 'getName' },
        __applyCalls: vi.fn(),
      };
      const browserMock = {
        __accessor: { kind: 'browser', channel: 'ipc-x' },
        __applyCalls: vi.fn(),
      };
      storeModule.default.getMocks.mockReturnValueOnce([
        ['electron.app.getName', nativeMock],
        [browserModeStoreKey(browser, 'ipc-x'), browserMock],
      ]);

      const oc = vi.mocked((browser as any).overwriteCommand);
      const overrideFn = oc.mock.calls.find((c: unknown[]) => c[0] === 'click')?.[1] as unknown as (
        this: WebdriverIO.Element,
        original: (...args: unknown[]) => Promise<unknown>,
        ...args: unknown[]
      ) => Promise<unknown>;

      const original = vi.fn().mockResolvedValue('ok');
      await overrideFn.call({} as unknown as WebdriverIO.Element, original);

      // Mixed registration: one CDP call for native, one renderer call for browser-mode.
      expect(executeMock).toHaveBeenCalledTimes(1);
      expect(browserExecute).toHaveBeenCalledTimes(1);
      expect(nativeMock.__applyCalls).toHaveBeenCalledTimes(1);
      expect(browserMock.__applyCalls).toHaveBeenCalledTimes(1);
    });

    it('should run two scheduler batches when two overrides fire concurrently', async () => {
      instance = new ElectronWorkerService({}, {});
      await instance.before({}, [], browser);

      const storeModule = (await import('../src/mockStore.js')) as any;
      const mockObj = { update: vi.fn().mockResolvedValue(undefined) };
      storeModule.default.getMocks.mockReturnValue([['id', mockObj]]);

      const oc = vi.mocked((browser as any).overwriteCommand);
      const overrideFn = oc.mock.calls.find((c: unknown[]) => c[0] === 'click')?.[1] as unknown as (
        this: WebdriverIO.Element,
        original: (...args: unknown[]) => Promise<unknown>,
        ...args: unknown[]
      ) => Promise<unknown>;

      const original = vi.fn().mockResolvedValue('ok');
      const p1 = overrideFn.call({} as unknown as WebdriverIO.Element, original);
      const p2 = overrideFn.call({} as unknown as WebdriverIO.Element, original);
      await Promise.all([p1, p2]);

      expect(mockObj.update).toHaveBeenCalledTimes(2);
    });

    it('should recover the scheduler after a batch update rejects', async () => {
      instance = new ElectronWorkerService({}, {});
      await instance.before({}, [], browser);

      const storeModule = (await import('../src/mockStore.js')) as any;
      const mockObj = { update: vi.fn().mockResolvedValue(undefined) };
      (mockObj.update as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
      storeModule.default.getMocks.mockReturnValue([['id', mockObj]]);

      const oc = vi.mocked((browser as any).overwriteCommand);
      const overrideFn = oc.mock.calls.find((c: unknown[]) => c[0] === 'click')?.[1] as unknown as (
        this: WebdriverIO.Element,
        original: (...args: unknown[]) => Promise<unknown>,
        ...args: unknown[]
      ) => Promise<unknown>;

      const original = vi.fn().mockResolvedValue('ok');
      await overrideFn.call({} as unknown as WebdriverIO.Element, original);
      await overrideFn.call({} as unknown as WebdriverIO.Element, original);

      expect(mockObj.update).toHaveBeenCalledTimes(2);
    });

    it('should copy original api', async () => {
      instance = new ElectronWorkerService({}, {});

      await instance.before({}, [], browser);

      // emulate the call to copyOriginalApi
      const internalCopyOriginalApi = vi.mocked(execute).mock.calls[0][2] as any;
      const dummyElectron = {
        dialog: {
          showOpenDialog: vi.fn(),
        },
      };
      await internalCopyOriginalApi(dummyElectron);

      // check if the originalApi is copied from the electron object
      expect(globalThis.originalApi).toMatchObject(dummyElectron);
    });

    describe('when multiremote', () => {
      it('should add electron commands to the browser object', async () => {
        instance = new ElectronWorkerService({}, {});
        browser.requestedCapabilities = {
          alwaysMatch: {
            browserName: 'electron',
            'wdio:electronServiceOptions': {},
          },
        };

        const rootBrowser = {
          instances: ['electron'],
          getInstance: (name: string) => (name === 'electron' ? browser : undefined),
          execute: vi.fn().mockResolvedValue(true),
          isMultiremote: true,
          overwriteCommand: vi.fn(),
        } as unknown as WebdriverIO.MultiRemoteBrowser;

        await instance.before({}, [], rootBrowser);

        // expect electron is set to root browser
        const rootServiceApi = rootBrowser.electron;
        expect(rootServiceApi.clearAllMocks).toEqual(expect.any(Function));
        expect(rootServiceApi.execute).toEqual(expect.any(Function));
        expect(rootServiceApi.mock).toEqual(expect.any(Function));
        expect(rootServiceApi.mockAll).toEqual(expect.any(Function));
        expect(rootServiceApi.resetAllMocks).toEqual(expect.any(Function));
        expect(rootServiceApi.restoreAllMocks).toEqual(expect.any(Function));

        // expect electron is set to electron browser
        const serviceApi = browser.electron;
        expect(serviceApi.clearAllMocks).toEqual(expect.any(Function));
        expect(serviceApi.execute).toEqual(expect.any(Function));
        expect(serviceApi.mock).toEqual(expect.any(Function));
        expect(serviceApi.mockAll).toEqual(expect.any(Function));
        expect(serviceApi.resetAllMocks).toEqual(expect.any(Function));
        expect(serviceApi.restoreAllMocks).toEqual(expect.any(Function));
      });

      it('should provide functional electron API on root multiremote browser', async () => {
        instance = new ElectronWorkerService({}, {});
        browser.requestedCapabilities = {
          alwaysMatch: {
            browserName: 'electron',
            'wdio:electronServiceOptions': {},
          },
        };

        const rootBrowser = {
          instances: ['electron'],
          getInstance: (name: string) => (name === 'electron' ? browser : undefined),
          execute: vi.fn().mockResolvedValue(true),
          isMultiremote: true,
          overwriteCommand: vi.fn(),
        } as unknown as WebdriverIO.MultiRemoteBrowser;

        await instance.before({}, [], rootBrowser);

        // The root browser should have a functional electron API
        const rootServiceApi = rootBrowser.electron;
        expect(rootServiceApi.clearAllMocks).toEqual(expect.any(Function));
        expect(rootServiceApi.execute).toEqual(expect.any(Function));
        expect(rootServiceApi.mock).toEqual(expect.any(Function));
        expect(rootServiceApi.mockAll).toEqual(expect.any(Function));
        expect(rootServiceApi.resetAllMocks).toEqual(expect.any(Function));
        expect(rootServiceApi.restoreAllMocks).toEqual(expect.any(Function));

        // Test that the root browser's execute method doesn't throw (it should work)
        expect(() => rootServiceApi.execute(() => {})).not.toThrow();
      });

      it('should continue with non-electron capabilities', async () => {
        instance = new ElectronWorkerService({}, {});

        browser.requestedCapabilities = {
          browserName: 'chrome',
        };

        const rootBrowser = {
          instances: ['electron'],
          getInstance: (name: string) => (name === 'electron' ? browser : undefined),
          execute: vi.fn().mockResolvedValue(true),
          isMultiremote: true,
          overwriteCommand: vi.fn(),
        } as unknown as WebdriverIO.MultiRemoteBrowser;

        await instance.before({}, [], rootBrowser);

        // expect electron is not set to electron browser
        const serviceApi = browser.electron;

        expect(serviceApi).toStrictEqual({});
      });

      it('should handle CDP bridge unavailability in multiremote instances', async () => {
        // Mock the CDP bridge initialization to fail for multiremote instances
        const { checkInspectFuse } = await import('../src/fuses.js');
        vi.mocked(checkInspectFuse).mockResolvedValue({ canUseCdpBridge: false });

        instance = new ElectronWorkerService({}, {});

        browser.requestedCapabilities = {
          alwaysMatch: {
            browserName: 'electron',
            'wdio:electronServiceOptions': {},
            'goog:chromeOptions': {
              binary: '/path/to/electron',
            },
          },
        };

        const rootBrowser = {
          instances: ['electron'],
          getInstance: (name: string) => (name === 'electron' ? browser : undefined),
          execute: vi.fn().mockResolvedValue(true),
          isMultiremote: true,
          overwriteCommand: vi.fn(),
        } as unknown as WebdriverIO.MultiRemoteBrowser;

        await instance.before({}, [], rootBrowser);

        // The multiremote instance should have error-throwing API methods
        const serviceApi = browser.electron;
        expect(serviceApi.clearAllMocks).toEqual(expect.any(Function));
        expect(serviceApi.execute).toEqual(expect.any(Function));
        expect(serviceApi.mock).toEqual(expect.any(Function));
        expect(serviceApi.mockAll).toEqual(expect.any(Function));
        expect(serviceApi.resetAllMocks).toEqual(expect.any(Function));
        expect(serviceApi.restoreAllMocks).toEqual(expect.any(Function));

        // Test that methods throw appropriate errors
        expect(() => serviceApi.execute(() => {})).toThrow('CDP bridge is not available, API is disabled');
        expect(() => serviceApi.clearAllMocks()).toThrow('CDP bridge is not available, API is disabled');
        expect(() => serviceApi.mock('app', 'getName')).toThrow('CDP bridge is not available, API is disabled');
        expect(() => serviceApi.mockAll('app')).toThrow('CDP bridge is not available, API is disabled');
        expect(() => serviceApi.resetAllMocks()).toThrow('CDP bridge is not available, API is disabled');
        expect(() => serviceApi.restoreAllMocks()).toThrow('CDP bridge is not available, API is disabled');
      });
    });
  });

  describe('beforeTest()', () => {
    beforeEach(() => {
      browser = {
        sessionId: 'dummyId',
        waitUntil: vi.fn().mockImplementation(async (condition) => {
          await condition();
        }),
        execute: vi.fn().mockImplementation((fn) => fn()),
        getWindowHandles: vi.fn().mockResolvedValue(['dummy']),
        switchToWindow: vi.fn(),
        getPuppeteer: vi.fn(),
        overwriteCommand: vi.fn(),
        electron: {},
      } as unknown as WebdriverIO.Browser;
    });

    it.each([
      [`clearMocks`, commands.clearAllMocks],
      [`resetMocks`, commands.resetAllMocks],
      [`restoreMocks`, commands.restoreAllMocks],
    ])('should clear all mocks when `%s` is set', async (option, fn) => {
      instance = new ElectronWorkerService({ [option]: true }, {});
      await instance.before({}, [], browser);
      await instance.beforeTest();

      expect(fn).toHaveBeenCalled();
    });
  });

  describe('beforeCommand()', () => {
    beforeEach(() => {
      vi.mocked(ensureActiveWindowFocus).mockClear();

      browser = {
        sessionId: 'dummyId',
        waitUntil: vi.fn().mockImplementation(async (condition) => {
          await condition();
        }),
        execute: vi.fn().mockImplementation((fn) => fn()),
        getWindowHandles: vi.fn().mockResolvedValue(['dummy']),
        switchToWindow: vi.fn(),
        getPuppeteer: vi.fn(),
        overwriteCommand: vi.fn(),
        electron: {},
      } as unknown as WebdriverIO.Browser;
    });

    it('should call `ensureActiveWindowFocus` for all commands', async () => {
      instance = new ElectronWorkerService({}, {});
      await instance.before({}, [], browser);
      await instance.beforeCommand('dummyCommand', []);

      expect(ensureActiveWindowFocus).toHaveBeenCalledWith(browser, 'dummyCommand');
    });

    it('should not call `ensureActiveWindowFocus` for excluded commands', async () => {
      instance = new ElectronWorkerService({}, {});
      await instance.before({}, [], browser);
      await instance.beforeCommand('getWindowHandles', []);

      expect(ensureActiveWindowFocus).toHaveBeenCalledTimes(0);
    });

    it('should not call `ensureActiveWindowFocus` for internal commands', async () => {
      instance = new ElectronWorkerService({}, {});
      await instance.before({}, [], browser);
      await instance.beforeCommand('dummyCommand', [{ internal: true }]);

      expect(ensureActiveWindowFocus).toHaveBeenCalledTimes(0);
    });
  });

  describe('after()', () => {
    it('should call clearPuppeteerSessions', async () => {
      instance = new ElectronWorkerService({}, {});
      browser = {
        sessionId: 'dummyId',
        waitUntil: vi.fn().mockImplementation(async (condition) => {
          await condition();
        }),
        execute: vi.fn().mockImplementation((fn) => fn()),
        getWindowHandles: vi.fn().mockResolvedValue(['dummy']),
        switchToWindow: vi.fn(),
        getPuppeteer: vi.fn(),
        overwriteCommand: vi.fn(),
        electron: {},
      } as unknown as WebdriverIO.Browser;

      await instance.before({}, [], browser);
      instance.after();

      expect(clearPuppeteerSessions).toHaveBeenCalled();
    });

    it('should stop log capture if it was initialized', async () => {
      const { LogCaptureManager } = await import('../src/logCapture.js');
      const mockStopCapture = vi.fn();
      vi.mocked(LogCaptureManager).mockImplementation(function () {
        return {
          captureMainProcessLogs: vi.fn().mockResolvedValue(undefined),
          captureRendererLogs: vi.fn().mockResolvedValue(undefined),
          stopCapture: mockStopCapture,
        } as any;
      });

      instance = new ElectronWorkerService(
        {
          captureMainProcessLogs: true,
        },
        {},
      );

      browser = {
        sessionId: 'dummyId',
        waitUntil: vi.fn().mockImplementation(async (condition) => {
          await condition();
        }),
        execute: vi.fn().mockImplementation((fn) => fn()),
        getWindowHandles: vi.fn().mockResolvedValue(['dummy']),
        switchToWindow: vi.fn(),
        getPuppeteer: vi.fn(),
        overwriteCommand: vi.fn(),
        electron: {},
      } as unknown as WebdriverIO.Browser;

      await instance.before({}, [], browser);
      instance.after();

      expect(mockStopCapture).toHaveBeenCalled();
      expect(clearPuppeteerSessions).toHaveBeenCalled();
    });
  });

  describe('Log Capture', () => {
    beforeEach(async () => {
      vi.clearAllMocks();

      // Mock getPuppeteer to return a Puppeteer browser object
      const { getPuppeteer } = await import('../src/window.js');
      vi.mocked(getPuppeteer).mockResolvedValue({} as any);

      browser = {
        sessionId: 'dummyId',
        waitUntil: vi.fn().mockImplementation(async (condition) => {
          await condition();
        }),
        execute: vi.fn().mockImplementation((fn) => fn()),
        getWindowHandles: vi.fn().mockResolvedValue(['dummy']),
        switchToWindow: vi.fn(),
        getPuppeteer: vi.fn().mockResolvedValue({}),
        overwriteCommand: vi.fn(),
        electron: {},
      } as unknown as WebdriverIO.Browser;
    });

    it('should initialize log capture when main process logging is enabled', async () => {
      const { LogCaptureManager } = await import('../src/logCapture.js');
      const mockCaptureMainProcessLogs = vi.fn().mockResolvedValue(undefined);
      vi.mocked(LogCaptureManager).mockImplementation(function () {
        return {
          captureMainProcessLogs: mockCaptureMainProcessLogs,
          captureRendererLogs: vi.fn().mockResolvedValue(undefined),
          stopCapture: vi.fn(),
        } as any;
      });

      instance = new ElectronWorkerService(
        {
          captureMainProcessLogs: true,
          mainProcessLogLevel: 'debug',
        },
        {},
      );

      await instance.before({}, [], browser);

      expect(LogCaptureManager).toHaveBeenCalled();
      expect(mockCaptureMainProcessLogs).toHaveBeenCalledWith(
        expect.anything(), // cdpBridge
        expect.objectContaining({
          captureMainProcessLogs: true,
          captureRendererLogs: false,
          mainProcessLogLevel: 'debug',
          rendererLogLevel: 'info',
        }),
        undefined, // instanceId
      );
    });

    it('should initialize log capture when renderer process logging is enabled', async () => {
      const { LogCaptureManager } = await import('../src/logCapture.js');
      const mockCaptureRendererLogs = vi.fn().mockResolvedValue(undefined);
      vi.mocked(LogCaptureManager).mockImplementation(function () {
        return {
          captureMainProcessLogs: vi.fn().mockResolvedValue(undefined),
          captureRendererLogs: mockCaptureRendererLogs,
          stopCapture: vi.fn(),
        } as any;
      });

      instance = new ElectronWorkerService(
        {
          captureRendererLogs: true,
          rendererLogLevel: 'warn',
        },
        {},
      );

      await instance.before({}, [], browser);

      expect(LogCaptureManager).toHaveBeenCalled();
      expect(mockCaptureRendererLogs).toHaveBeenCalledWith(
        expect.any(Object), // puppeteerBrowser
        expect.objectContaining({
          captureMainProcessLogs: false,
          captureRendererLogs: true,
          mainProcessLogLevel: 'info',
          rendererLogLevel: 'warn',
        }),
        undefined, // instanceId
      );
    });

    it('should initialize log capture for both main and renderer processes', async () => {
      const { LogCaptureManager } = await import('../src/logCapture.js');
      const mockCaptureMainProcessLogs = vi.fn().mockResolvedValue(undefined);
      const mockCaptureRendererLogs = vi.fn().mockResolvedValue(undefined);
      vi.mocked(LogCaptureManager).mockImplementation(function () {
        return {
          captureMainProcessLogs: mockCaptureMainProcessLogs,
          captureRendererLogs: mockCaptureRendererLogs,
          stopCapture: vi.fn(),
        } as any;
      });

      instance = new ElectronWorkerService(
        {
          captureMainProcessLogs: true,
          captureRendererLogs: true,
          mainProcessLogLevel: 'info',
          rendererLogLevel: 'debug',
        },
        {},
      );

      await instance.before({}, [], browser);

      expect(LogCaptureManager).toHaveBeenCalled();
      expect(mockCaptureMainProcessLogs).toHaveBeenCalled();
      expect(mockCaptureRendererLogs).toHaveBeenCalled();
    });

    it('should not initialize log capture when logging is disabled', async () => {
      const { LogCaptureManager } = await import('../src/logCapture.js');

      instance = new ElectronWorkerService({}, {});

      await instance.before({}, [], browser);

      expect(LogCaptureManager).not.toHaveBeenCalled();
    });

    it('should allow renderer logs to work even when CDP bridge is unavailable', async () => {
      const { checkInspectFuse } = await import('../src/fuses.js');
      vi.mocked(checkInspectFuse).mockResolvedValueOnce({ canUseCdpBridge: false });

      const { LogCaptureManager } = await import('../src/logCapture.js');
      const mockCaptureMainProcessLogs = vi.fn().mockResolvedValue(undefined);
      const mockCaptureRendererLogs = vi.fn().mockResolvedValue(undefined);
      vi.mocked(LogCaptureManager).mockImplementation(function () {
        return {
          captureMainProcessLogs: mockCaptureMainProcessLogs,
          captureRendererLogs: mockCaptureRendererLogs,
          stopCapture: vi.fn(),
        } as any;
      });

      instance = new ElectronWorkerService(
        {
          captureMainProcessLogs: true, // This won't work without CDP bridge
          captureRendererLogs: true, // This should still work
        },
        {},
      );

      const capabilities = {
        'goog:chromeOptions': {
          binary: '/path/to/electron',
        },
      };

      await instance.before(capabilities, [], browser);

      // LogCaptureManager should still be created
      expect(LogCaptureManager).toHaveBeenCalled();

      // Main process logs should not be captured (CDP bridge unavailable)
      expect(mockCaptureMainProcessLogs).not.toHaveBeenCalled();

      // Renderer logs should still be captured (works independently)
      expect(mockCaptureRendererLogs).toHaveBeenCalled();
    });

    it('should pass logDir option to log capture', async () => {
      const { LogCaptureManager } = await import('../src/logCapture.js');
      const mockCaptureMainProcessLogs = vi.fn().mockResolvedValue(undefined);
      vi.mocked(LogCaptureManager).mockImplementation(function () {
        return {
          captureMainProcessLogs: mockCaptureMainProcessLogs,
          captureRendererLogs: vi.fn().mockResolvedValue(undefined),
          stopCapture: vi.fn(),
        } as any;
      });

      instance = new ElectronWorkerService(
        {
          captureMainProcessLogs: true,
          logDir: './custom-logs',
        },
        {},
      );

      await instance.before({}, [], browser);

      expect(mockCaptureMainProcessLogs).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          logDir: './custom-logs',
        }),
        undefined,
      );
    });

    describe('multiremote', () => {
      it('should initialize log capture for multiremote instances', async () => {
        const { LogCaptureManager } = await import('../src/logCapture.js');
        const mockCaptureMainProcessLogs = vi.fn().mockResolvedValue(undefined);
        const mockCaptureRendererLogs = vi.fn().mockResolvedValue(undefined);
        vi.mocked(LogCaptureManager).mockImplementation(function () {
          return {
            captureMainProcessLogs: mockCaptureMainProcessLogs,
            captureRendererLogs: mockCaptureRendererLogs,
            stopCapture: vi.fn(),
          } as any;
        });

        instance = new ElectronWorkerService({}, {});

        browser.requestedCapabilities = {
          alwaysMatch: {
            browserName: 'electron',
            'wdio:electronServiceOptions': {
              captureMainProcessLogs: true,
              captureRendererLogs: true,
            },
          },
        };

        const rootBrowser = {
          instances: ['app1'],
          getInstance: (name: string) => (name === 'app1' ? browser : undefined),
          execute: vi.fn().mockResolvedValue(true),
          isMultiremote: true,
          overwriteCommand: vi.fn(),
        } as unknown as WebdriverIO.MultiRemoteBrowser;

        await instance.before({}, [], rootBrowser);

        // Should be called with instance ID
        expect(mockCaptureMainProcessLogs).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            captureMainProcessLogs: true,
            captureRendererLogs: true,
          }),
          'app1', // instanceId
        );

        expect(mockCaptureRendererLogs).toHaveBeenCalledWith(
          expect.any(Object),
          expect.objectContaining({
            captureMainProcessLogs: true,
            captureRendererLogs: true,
          }),
          'app1', // instanceId
        );
      });

      it('should allow multiremote renderer logs without CDP bridge', async () => {
        const { checkInspectFuse } = await import('../src/fuses.js');
        vi.mocked(checkInspectFuse).mockResolvedValue({ canUseCdpBridge: false });

        const { LogCaptureManager } = await import('../src/logCapture.js');
        const mockCaptureMainProcessLogs = vi.fn().mockResolvedValue(undefined);
        const mockCaptureRendererLogs = vi.fn().mockResolvedValue(undefined);
        vi.mocked(LogCaptureManager).mockImplementation(function () {
          return {
            captureMainProcessLogs: mockCaptureMainProcessLogs,
            captureRendererLogs: mockCaptureRendererLogs,
            stopCapture: vi.fn(),
          } as any;
        });

        instance = new ElectronWorkerService({}, {});

        browser.requestedCapabilities = {
          alwaysMatch: {
            browserName: 'electron',
            'wdio:electronServiceOptions': {
              captureMainProcessLogs: true,
              captureRendererLogs: true,
            },
            'goog:chromeOptions': {
              binary: '/path/to/electron',
            },
          },
        };

        const rootBrowser = {
          instances: ['app1'],
          getInstance: (name: string) => (name === 'app1' ? browser : undefined),
          execute: vi.fn().mockResolvedValue(true),
          isMultiremote: true,
          overwriteCommand: vi.fn(),
        } as unknown as WebdriverIO.MultiRemoteBrowser;

        await instance.before({}, [], rootBrowser);

        // Main process logs should not be captured (CDP bridge unavailable)
        expect(mockCaptureMainProcessLogs).not.toHaveBeenCalled();

        // Renderer logs should still be captured
        expect(mockCaptureRendererLogs).toHaveBeenCalledWith(
          expect.any(Object),
          expect.objectContaining({
            captureMainProcessLogs: true,
            captureRendererLogs: true,
          }),
          'app1',
        );
      });

      it('should not initialize log capture for multiremote instances without logging options', async () => {
        const { LogCaptureManager } = await import('../src/logCapture.js');

        instance = new ElectronWorkerService({}, {});

        browser.requestedCapabilities = {
          alwaysMatch: {
            browserName: 'electron',
            'wdio:electronServiceOptions': {},
          },
        };

        const rootBrowser = {
          instances: ['app1'],
          getInstance: (name: string) => (name === 'app1' ? browser : undefined),
          execute: vi.fn().mockResolvedValue(true),
          isMultiremote: true,
          overwriteCommand: vi.fn(),
        } as unknown as WebdriverIO.MultiRemoteBrowser;

        await instance.before({}, [], rootBrowser);

        // LogCaptureManager should not be called
        expect(LogCaptureManager).not.toHaveBeenCalled();
      });
    });
  });

  describe('browser mode', () => {
    let browserModeBrowser: WebdriverIO.Browser;

    beforeEach(() => {
      browserModeBrowser = {
        url: vi.fn().mockResolvedValue(undefined),
        execute: vi.fn().mockResolvedValue(undefined),
        // Mirror webdriverio's overwriteCommand: wire the override onto the named command so
        // a later browser.url(...) runs through it (with `this` bound to the browser). Commands
        // the mock doesn't define (click/doubleClick/…) are recorded but not wired.
        overwriteCommand: vi.fn((name: string, fn: (...a: unknown[]) => unknown) => {
          const b = browserModeBrowser as unknown as Record<string, unknown>;
          const original = b[name];
          if (typeof original === 'function') {
            b[name] = (...args: unknown[]) =>
              (fn as (...a: unknown[]) => unknown).call(
                browserModeBrowser,
                (original as (...a: unknown[]) => unknown).bind(browserModeBrowser),
                ...args,
              );
          }
        }),
        electron: {},
      } as unknown as WebdriverIO.Browser;
    });

    describe('patchBrowserUrl()', () => {
      it('should re-throw when the IPC injection script fails after navigation', async () => {
        instance = new ElectronWorkerService({ mode: 'browser', devServerUrl: 'http://localhost:5173' }, {});
        await instance.before({}, [], browserModeBrowser);

        (browserModeBrowser.execute as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
          new Error('Script injection blocked'),
        );

        await expect(browserModeBrowser.url('http://localhost:5173/settings')).rejects.toThrow(
          'Script injection blocked',
        );
      });

      it('should resolve normally when the injection script succeeds after navigation', async () => {
        instance = new ElectronWorkerService({ mode: 'browser', devServerUrl: 'http://localhost:5173' }, {});
        await instance.before({}, [], browserModeBrowser);

        await expect(browserModeBrowser.url('http://localhost:5173/settings')).resolves.toBeUndefined();
      });

      it('should install element command overrides in browser mode', async () => {
        instance = new ElectronWorkerService({ mode: 'browser', devServerUrl: 'http://localhost:5173' }, {});
        await instance.before({}, [], browserModeBrowser);

        const oc = vi.mocked((browserModeBrowser as any).overwriteCommand);
        const overridden = oc.mock.calls.map((c: unknown[]) => ({ name: c[0], isElement: c[2] }));
        expect(overridden).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: 'click', isElement: true }),
            expect.objectContaining({ name: 'doubleClick', isElement: true }),
            expect.objectContaining({ name: 'setValue', isElement: true }),
            expect.objectContaining({ name: 'clearValue', isElement: true }),
          ]),
        );
      });

      it('should route emitEvent through browser.execute in browser mode', async () => {
        instance = new ElectronWorkerService({ mode: 'browser', devServerUrl: 'http://localhost:5173' }, {});
        await instance.before({}, [], browserModeBrowser);

        const executeMock = vi.mocked(browserModeBrowser.execute as ReturnType<typeof vi.fn>);
        executeMock.mockClear();

        const serviceApi = browserModeBrowser.electron as BrowserExtension['electron'];
        await serviceApi.emitEvent('did-update-info', { count: 7 });

        expect(executeMock).toHaveBeenCalled();
        const call = executeMock.mock.calls[0];
        expect(typeof call[0]).toBe('function');
        expect(call[1]).toBe('did-update-info');
        expect(call[2]).toEqual([{ count: 7 }]);
      });

      it('should not run the injection script when url() is called without a href', async () => {
        instance = new ElectronWorkerService({ mode: 'browser', devServerUrl: 'http://localhost:5173' }, {});
        await instance.before({}, [], browserModeBrowser);

        const executeCallsBefore = (browserModeBrowser.execute as ReturnType<typeof vi.fn>).mock.calls.length;
        await browserModeBrowser.url();
        const executeCallsAfter = (browserModeBrowser.execute as ReturnType<typeof vi.fn>).mock.calls.length;

        expect(executeCallsAfter).toBe(executeCallsBefore);
      });
    });

    describe('multiremote missing devServerUrl', () => {
      it('should throw SevereServiceError when an Electron instance has no devServerUrl', async () => {
        instance = new ElectronWorkerService({ mode: 'browser' }, {});

        browserModeBrowser.requestedCapabilities = {
          alwaysMatch: { browserName: 'electron', 'wdio:electronServiceOptions': {} },
        };

        const rootBrowser = {
          instances: ['app1'],
          getInstance: (name: string) => (name === 'app1' ? browserModeBrowser : undefined),
          execute: vi.fn().mockResolvedValue(undefined),
          url: vi.fn().mockResolvedValue(undefined),
          overwriteCommand: vi.fn(),
          isMultiremote: true,
          electron: {},
        } as unknown as WebdriverIO.MultiRemoteBrowser;

        const { SevereServiceError } = await import('webdriverio');
        await expect(instance.before({}, [], rootBrowser)).rejects.toBeInstanceOf(SevereServiceError);
      });
    });

    describe('mixed multiremote (non-Electron instances skipped)', () => {
      it('should not inject the IPC script into non-Electron multiremote instances', async () => {
        instance = new ElectronWorkerService({ mode: 'browser', devServerUrl: 'http://localhost:5173' }, {});

        const electronBrowser = {
          url: vi.fn().mockResolvedValue(undefined),
          execute: vi.fn().mockResolvedValue(undefined),
          overwriteCommand: vi.fn(),
          requestedCapabilities: {
            alwaysMatch: { browserName: 'electron', 'wdio:electronServiceOptions': {} },
          },
          electron: {},
        } as unknown as WebdriverIO.Browser;

        const firefoxBrowser = {
          url: vi.fn().mockResolvedValue(undefined),
          execute: vi.fn().mockResolvedValue(undefined),
          overwriteCommand: vi.fn(),
          requestedCapabilities: {
            alwaysMatch: { browserName: 'firefox' },
          },
          electron: {},
        } as unknown as WebdriverIO.Browser;

        const rootBrowser = {
          instances: ['app1', 'ff1'],
          getInstance: (name: string) => (name === 'app1' ? electronBrowser : firefoxBrowser),
          execute: vi.fn().mockResolvedValue(undefined),
          url: vi.fn().mockResolvedValue(undefined),
          overwriteCommand: vi.fn(),
          isMultiremote: true,
          electron: {},
        } as unknown as WebdriverIO.MultiRemoteBrowser;

        await instance.before({}, [], rootBrowser);

        // Electron instance gets the injection script
        expect((electronBrowser.execute as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
        // Firefox instance gets no execute calls at all
        expect((firefoxBrowser.execute as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
        expect((firefoxBrowser.url as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
      });

      it('should re-inject only into the Electron session a navigation fires on (flag-guarded)', async () => {
        instance = new ElectronWorkerService({ mode: 'browser', devServerUrl: 'http://localhost:5173' }, {});

        const electronBrowser = {
          url: vi.fn().mockResolvedValue(undefined),
          execute: vi.fn().mockResolvedValue(undefined),
          overwriteCommand: vi.fn(),
          requestedCapabilities: {
            alwaysMatch: { browserName: 'electron', 'wdio:electronServiceOptions': {} },
          },
          electron: {},
        } as unknown as WebdriverIO.Browser;

        const firefoxBrowser = {
          url: vi.fn().mockResolvedValue(undefined),
          execute: vi.fn().mockResolvedValue(undefined),
          overwriteCommand: vi.fn(),
          requestedCapabilities: { alwaysMatch: { browserName: 'firefox' } },
          electron: {},
        } as unknown as WebdriverIO.Browser;

        const rootOverwriteCommand = vi.fn();
        const rootBrowser = {
          instances: ['app1', 'ff1'],
          getInstance: (name: string) => (name === 'app1' ? electronBrowser : firefoxBrowser),
          execute: vi.fn().mockResolvedValue(undefined),
          url: vi.fn().mockResolvedValue(undefined),
          overwriteCommand: rootOverwriteCommand,
          isMultiremote: true,
          electron: {},
        } as unknown as WebdriverIO.MultiRemoteBrowser;

        await instance.before({}, [], rootBrowser);

        // The url override is registered once on the root; webdriverio propagates it to every
        // instance, where it fires with `this` bound to that instance. Re-injection is gated on
        // __wdioElectronBrowserMode__, set during before() on Electron instances only.
        const urlOverride = rootOverwriteCommand.mock.calls.find((c) => c[0] === 'url')?.[1] as (
          this: WebdriverIO.Browser,
          originalUrl: (href?: string) => Promise<unknown>,
          href?: string,
        ) => Promise<unknown>;
        expect(urlOverride).toBeTypeOf('function');

        // Fires on the Electron instance (flag set) → re-injects.
        const electronExecuteBefore = (electronBrowser.execute as ReturnType<typeof vi.fn>).mock.calls.length;
        await urlOverride.call(
          electronBrowser,
          electronBrowser.url as unknown as (href?: string) => Promise<unknown>,
          'http://localhost:5173/new-page',
        );
        expect((electronBrowser.execute as ReturnType<typeof vi.fn>).mock.calls.length).toBe(electronExecuteBefore + 1);

        // Fires on the non-Electron instance (no flag) → no re-injection.
        const firefoxExecuteBefore = (firefoxBrowser.execute as ReturnType<typeof vi.fn>).mock.calls.length;
        await urlOverride.call(
          firefoxBrowser,
          firefoxBrowser.url as unknown as (href?: string) => Promise<unknown>,
          'http://localhost:5173/new-page',
        );
        expect((firefoxBrowser.execute as ReturnType<typeof vi.fn>).mock.calls.length).toBe(firefoxExecuteBefore);
      });

      it('should install command overrides only on the root browser, not on individual Electron instances', async () => {
        instance = new ElectronWorkerService({ mode: 'browser', devServerUrl: 'http://localhost:5173' }, {});

        const electronBrowser = {
          url: vi.fn().mockResolvedValue(undefined),
          execute: vi.fn().mockResolvedValue(undefined),
          overwriteCommand: vi.fn(),
          requestedCapabilities: {
            alwaysMatch: { browserName: 'electron', 'wdio:electronServiceOptions': {} },
          },
          electron: {},
        } as unknown as WebdriverIO.Browser;

        const rootBrowser = {
          instances: ['app1'],
          getInstance: (name: string) => (name === 'app1' ? electronBrowser : undefined),
          execute: vi.fn().mockResolvedValue(undefined),
          url: vi.fn().mockResolvedValue(undefined),
          overwriteCommand: vi.fn(),
          isMultiremote: true,
          electron: {},
        } as unknown as WebdriverIO.MultiRemoteBrowser;

        await instance.before({}, [], rootBrowser);

        // Root browser gets overwriteCommand calls (for click, doubleClick, setValue, clearValue)
        expect((rootBrowser.overwriteCommand as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
        // Per-instance browser gets no direct overwriteCommand call: WDIO's multiremote
        // overwriteCommand wrapper propagates to all instances' __elementOverrides__ internally,
        // so a separate call on each instance would double-wrap element commands.
        expect((electronBrowser.overwriteCommand as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
      });
    });

    describe('root multiremote browser.electron.mock()', () => {
      it('should throw when mock() is called on the root multiremote browser in browser mode', async () => {
        instance = new ElectronWorkerService({ mode: 'browser', devServerUrl: 'http://localhost:5173' }, {});

        browserModeBrowser.requestedCapabilities = {
          alwaysMatch: { browserName: 'electron', 'wdio:electronServiceOptions': {} },
        };

        const rootBrowser = {
          instances: ['app1'],
          getInstance: (name: string) => (name === 'app1' ? browserModeBrowser : undefined),
          execute: vi.fn().mockResolvedValue(undefined),
          url: vi.fn().mockResolvedValue(undefined),
          overwriteCommand: vi.fn(),
          isMultiremote: true,
          electron: {},
        } as unknown as WebdriverIO.MultiRemoteBrowser;

        await instance.before({}, [], rootBrowser);

        await expect((rootBrowser as unknown as WebdriverIO.Browser).electron.mock('my_channel')).rejects.toThrow(
          'browser.electron.mock() on the root multiremote browser is not supported in browser mode',
        );
      });

      it('should throw when emitEvent() is called on the root multiremote browser in browser mode', async () => {
        instance = new ElectronWorkerService({ mode: 'browser', devServerUrl: 'http://localhost:5173' }, {});

        browserModeBrowser.requestedCapabilities = {
          alwaysMatch: { browserName: 'electron', 'wdio:electronServiceOptions': {} },
        };

        const rootBrowser = {
          instances: ['app1'],
          getInstance: (name: string) => (name === 'app1' ? browserModeBrowser : undefined),
          execute: vi.fn().mockResolvedValue(undefined),
          url: vi.fn().mockResolvedValue(undefined),
          overwriteCommand: vi.fn(),
          isMultiremote: true,
          electron: {},
        } as unknown as WebdriverIO.MultiRemoteBrowser;

        await instance.before({}, [], rootBrowser);

        await expect(
          (rootBrowser as unknown as WebdriverIO.Browser).electron.emitEvent('did-update-info', { count: 3 }),
        ).rejects.toThrow(
          'browser.electron.emitEvent() on the root multiremote browser is not supported in browser mode',
        );
      });

      it('should include the channel name and per-instance guidance in the error message', async () => {
        instance = new ElectronWorkerService({ mode: 'browser', devServerUrl: 'http://localhost:5173' }, {});

        browserModeBrowser.requestedCapabilities = {
          alwaysMatch: { browserName: 'electron', 'wdio:electronServiceOptions': {} },
        };

        const rootBrowser = {
          instances: ['app1'],
          getInstance: (name: string) => (name === 'app1' ? browserModeBrowser : undefined),
          execute: vi.fn().mockResolvedValue(undefined),
          url: vi.fn().mockResolvedValue(undefined),
          overwriteCommand: vi.fn(),
          isMultiremote: true,
          electron: {},
        } as unknown as WebdriverIO.MultiRemoteBrowser;

        await instance.before({}, [], rootBrowser);

        await expect((rootBrowser as unknown as WebdriverIO.Browser).electron.mock('read_file')).rejects.toThrow(
          "getInstance('name').electron.mock('read_file')",
        );
      });

      it('should allow mock() on a per-instance browser in multiremote browser mode', async () => {
        instance = new ElectronWorkerService({ mode: 'browser', devServerUrl: 'http://localhost:5173' }, {});

        browserModeBrowser.requestedCapabilities = {
          alwaysMatch: { browserName: 'electron', 'wdio:electronServiceOptions': {} },
        };
        (browserModeBrowser.execute as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

        const rootBrowser = {
          instances: ['app1'],
          getInstance: (name: string) => (name === 'app1' ? browserModeBrowser : undefined),
          execute: vi.fn().mockResolvedValue(undefined),
          url: vi.fn().mockResolvedValue(undefined),
          overwriteCommand: vi.fn(),
          isMultiremote: true,
          electron: {},
        } as unknown as WebdriverIO.MultiRemoteBrowser;

        await instance.before({}, [], rootBrowser);

        const perInstanceBrowser = rootBrowser.getInstance('app1') as WebdriverIO.Browser;
        await expect(perInstanceBrowser.electron.mock('read_file')).resolves.toBeDefined();
      });
    });
  });
});

describe('Electron Worker Service - afterSession()', () => {
  it('should restore mocks, then clear the mock store', async () => {
    vi.mocked(restoreAllMocks).mockResolvedValueOnce(undefined);
    const instance = new ElectronWorkerService({}, {});

    await instance.afterSession();

    expect(restoreAllMocks).toHaveBeenCalledTimes(1);
    expect(mockStore.clear).toHaveBeenCalledTimes(1);
  });

  it('should swallow a benign CDP disconnect error and still clear the store', async () => {
    // The Windows hang: a CDP send() during teardown rejects with "WebSocket is
    // not connected" once the debugger socket is gone; left to propagate it fails
    // an otherwise-green run. It must be swallowed, and the store still cleared.
    vi.mocked(restoreAllMocks).mockRejectedValueOnce(new Error('WebSocket is not connected'));
    const instance = new ElectronWorkerService({}, {});

    await expect(instance.afterSession()).resolves.toBeUndefined();
    expect(mockStore.clear).toHaveBeenCalledTimes(1);
  });

  it('should still clear the store after a non-benign restore error', async () => {
    vi.mocked(restoreAllMocks).mockRejectedValueOnce(new Error('unexpected teardown failure'));
    const instance = new ElectronWorkerService({}, {});

    await expect(instance.afterSession()).resolves.toBeUndefined();
    expect(mockStore.clear).toHaveBeenCalledTimes(1);
  });

  it('should not hang when restoreAllMocks never settles, bounded by timeout', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(restoreAllMocks).mockImplementationOnce(() => new Promise<void>(() => {}));
      const instance = new ElectronWorkerService({}, {});

      const pending = instance.afterSession();
      await vi.advanceTimersByTimeAsync(10_000);

      await expect(pending).resolves.toBeUndefined();
      expect(mockStore.clear).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
