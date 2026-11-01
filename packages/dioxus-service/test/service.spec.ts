import type { DioxusMock } from '@wdio/native-types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import mockStore from '../src/mockStore.js';
import DioxusWorkerService from '../src/service.js';
import type { DioxusServiceOptions } from '../src/types.js';
import { createFakeMultiremote } from './commands/multiremoteFakes.js';

function makeBrowser(): WebdriverIO.Browser {
  return { execute: vi.fn().mockResolvedValue(undefined) } as unknown as WebdriverIO.Browser;
}

function fakeMock(name: string) {
  return {
    getMockName: () => name,
    mockClear: vi.fn().mockResolvedValue(undefined),
    mockReset: vi.fn().mockResolvedValue(undefined),
    mockRestore: vi.fn().mockResolvedValue(undefined),
  } as unknown as DioxusMock & Record<'mockClear' | 'mockReset' | 'mockRestore', ReturnType<typeof vi.fn>>;
}

// Mock browser whose overwriteCommand mirrors webdriverio: it wires the override onto the
// named command so a later browser.url(...) runs through it, with `this` bound to the browser.
// (browser.url is a read-only command property in real wdio, hence overwriteCommand.)
function makeBrowserModeBrowser(): WebdriverIO.Browser & { url: ReturnType<typeof vi.fn> } {
  const browser: Record<string, unknown> = {
    execute: vi.fn().mockResolvedValue(undefined),
    url: vi.fn().mockResolvedValue(undefined),
    overwriteCommand(name: string, fn: (original: (...a: unknown[]) => unknown, ...a: unknown[]) => unknown) {
      const original = browser[name] as (...a: unknown[]) => unknown;
      browser[name] = (...args: unknown[]) => fn.call(browser, original.bind(browser), ...args);
    },
  };
  return browser as unknown as WebdriverIO.Browser & { url: ReturnType<typeof vi.fn> };
}

type Installed = {
  dioxus: {
    execute: (s: string | (() => unknown)) => Promise<unknown>;
    mock: (command: string) => Promise<unknown>;
    clearAllMocks: (prefix?: string) => Promise<void>;
    resetAllMocks: (prefix?: string) => Promise<void>;
    restoreAllMocks: (prefix?: string) => Promise<void>;
    isMockFunction: (x: unknown) => boolean;
    switchWindow: (label: string) => Promise<void>;
    listWindows: () => Promise<string[]>;
    triggerDeeplink: (url: string) => Promise<void>;
  };
};

describe('DioxusWorkerService', () => {
  afterEach(() => {
    mockStore.clear();
  });

  it('should install browser.dioxus on before()', async () => {
    const browser = makeBrowser();
    const service = new DioxusWorkerService({}, {});

    await service.before({}, [], browser);

    const dioxus = (browser as unknown as Installed).dioxus;
    expect(dioxus).toBeDefined();
    expect(typeof dioxus.execute).toBe('function');
    expect(typeof dioxus.mock).toBe('function');
    expect(typeof dioxus.clearAllMocks).toBe('function');
    expect(typeof dioxus.resetAllMocks).toBe('function');
    expect(typeof dioxus.restoreAllMocks).toBe('function');
    expect(typeof dioxus.isMockFunction).toBe('function');
    expect(typeof dioxus.switchWindow).toBe('function');
    expect(typeof dioxus.listWindows).toBe('function');
    expect(typeof dioxus.triggerDeeplink).toBe('function');
  });

  it('should route browser.dioxus.execute through the underlying browser.execute', async () => {
    const browser = makeBrowser();
    // The first two calls are the injection script and the stale-mock reset.
    vi.mocked(browser.execute)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('out');

    const service = new DioxusWorkerService({}, {});
    await service.before({}, [], browser);

    const result = await (browser as unknown as Installed).dioxus.execute('return 1');

    expect(result).toBe('out');
    expect(browser.execute).toHaveBeenCalledWith('return 1');
  });

  it('should expose a working isMockFunction', async () => {
    const browser = makeBrowser();
    const service = new DioxusWorkerService({}, {});
    await service.before({}, [], browser);

    const { isMockFunction } = (browser as unknown as Installed).dioxus;
    const fakeMock = (() => undefined) as unknown as Record<string, unknown>;
    fakeMock.__isDioxusMock = true;

    expect(isMockFunction(fakeMock)).toBe(true);
    expect(isMockFunction(() => undefined)).toBe(false);
  });

  it('should inject the @wdio/native-spy mock-factory + invoke patch in before()', async () => {
    const browser = makeBrowser();
    const service = new DioxusWorkerService({}, {});

    await service.before({}, [], browser);

    // The first browser.execute call should be the injection script that
    // installs window.__wdio_spy__ and patches window.__WDIO_DIOXUS__.invoke.
    const calls = vi.mocked(browser.execute).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const [firstScript] = calls[0] as [string];
    expect(firstScript).toContain('__wdio_spy__');
    expect(firstScript).toContain('window.__WDIO_DIOXUS__');
  });

  it('should not throw when injection fails (degrades to warn-and-continue)', async () => {
    const browser = makeBrowser();
    vi.mocked(browser.execute).mockRejectedValueOnce(new Error('webview not ready'));
    const service = new DioxusWorkerService({}, {});

    await expect(service.before({}, [], browser)).resolves.toBeUndefined();
    // browser.dioxus is still installed even after the injection failure.
    expect((browser as unknown as Installed).dioxus).toBeDefined();
  });

  it('should clear stale in-app mocks at session start in embedded mode', async () => {
    const browser = makeBrowser();
    const service = new DioxusWorkerService({}, {});
    await service.before({}, [], browser);

    const reset = vi.mocked(browser.execute).mock.calls[1][0] as () => void;
    vi.stubGlobal('__wdio_mocks__', { greet: () => 'stale' });
    try {
      reset();
      expect((globalThis as { __wdio_mocks__?: unknown }).__wdio_mocks__).toEqual({});
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('should not reset in-app mocks for the external driver provider', async () => {
    const browser = makeBrowser();
    const service = new DioxusWorkerService({ driverProvider: 'external' }, {});
    await service.before({}, [], browser);

    expect(browser.execute).toHaveBeenCalledTimes(1);
  });

  it('should continue when the stale-mock reset fails', async () => {
    const browser = makeBrowser();
    vi.mocked(browser.execute).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('no such window'));
    const service = new DioxusWorkerService({}, {});

    await expect(service.before({}, [], browser)).resolves.toBeUndefined();
    expect((browser as unknown as Installed).dioxus).toBeDefined();
  });

  it('should clear the mockStore in afterSession() without restoring mocks in the app', async () => {
    const greet = fakeMock('dioxus.greet');
    mockStore.setMock(makeBrowser(), greet);

    const service = new DioxusWorkerService({}, {});
    await service.afterSession();

    expect(greet.mockRestore).not.toHaveBeenCalled();
    expect(mockStore.getAllMocks()).toHaveLength(0);
  });

  describe('beforeTest()', () => {
    async function setUp(options: DioxusServiceOptions, capabilities: unknown = {}) {
      const browser = makeBrowser();
      const service = new DioxusWorkerService(options, capabilities);
      await service.before({}, [], browser);
      const fsRead = fakeMock('dioxus.fs_read');
      const netFetch = fakeMock('dioxus.net_fetch');
      mockStore.setMock(browser, fsRead);
      mockStore.setMock(browser, netFetch);
      return { service, fsRead, netFetch };
    }

    it('should leave the mocks alone when no mock option is set', async () => {
      const { service, fsRead } = await setUp({});

      await service.beforeTest({}, {});

      expect(fsRead.mockClear).not.toHaveBeenCalled();
      expect(fsRead.mockReset).not.toHaveBeenCalled();
      expect(fsRead.mockRestore).not.toHaveBeenCalled();
    });

    it.each([
      { option: 'clearMocks', method: 'mockClear' },
      { option: 'resetMocks', method: 'mockReset' },
      { option: 'restoreMocks', method: 'mockRestore' },
    ] as const)('should run $method on the mocks matching the prefix with $option', async ({ option, method }) => {
      const { service, fsRead, netFetch } = await setUp({ [option]: true, [`${option}Prefix`]: 'fs' });

      await service.beforeTest({}, {});

      expect(fsRead[method]).toHaveBeenCalledOnce();
      expect(netFetch[method]).not.toHaveBeenCalled();
    });

    it('should read the options from wdio:dioxusServiceOptions', async () => {
      const { service, fsRead } = await setUp({}, { 'wdio:dioxusServiceOptions': { clearMocks: true } });

      await service.beforeTest({}, {});

      expect(fsRead.mockClear).toHaveBeenCalledOnce();
    });

    it('should run every configured op and then report each failure', async () => {
      const { service, fsRead } = await setUp({ clearMocks: true, resetMocks: true, restoreMocks: true });
      fsRead.mockClear.mockRejectedValueOnce(new Error('clear failed'));
      fsRead.mockRestore.mockRejectedValueOnce(new Error('restore failed'));

      await expect(service.beforeTest({}, {})).rejects.toMatchObject({
        message: 'mockClear failed: dioxus.fs_read: clear failed; mockRestore failed: dioxus.fs_read: restore failed',
        errors: [
          { message: expect.stringContaining('clear failed') },
          { message: expect.stringContaining('restore failed') },
        ],
      });
      expect(fsRead.mockReset).toHaveBeenCalledOnce();
    });
  });

  describe('in multiremote', () => {
    type InstanceApi = Installed['dioxus'];

    async function setUp(
      options: DioxusServiceOptions = {},
      instanceOptions: Partial<Record<'browserA' | 'browserB', DioxusServiceOptions>> = {},
    ) {
      const fakes = createFakeMultiremote();
      const capabilitiesOf = (name: 'browserA' | 'browserB') =>
        instanceOptions[name] ? { 'wdio:dioxusServiceOptions': instanceOptions[name] } : {};
      const service = new DioxusWorkerService(options, {
        browserA: { capabilities: capabilitiesOf('browserA') },
        browserB: { capabilities: capabilitiesOf('browserB') },
      });
      await service.before({}, [], fakes.root);
      const dioxusOf = (browser: unknown) => (browser as Installed).dioxus as InstanceApi;
      const mocks = [fakes.browserA, fakes.browserB, fakes.root].map((owner) => {
        const mock = fakeMock('dioxus.greet');
        mockStore.setMock(owner, mock);
        return mock;
      });
      return { service, fakes, dioxusOf, mocks };
    }

    it("should bind each instance's bulk ops to that instance's mocks", async () => {
      const { fakes, dioxusOf, mocks } = await setUp();
      const [mockA, mockB, rootMock] = mocks;

      await dioxusOf(fakes.browserA).restoreAllMocks();
      await dioxusOf(fakes.browserB).clearAllMocks();

      expect(mockA.mockRestore).toHaveBeenCalledOnce();
      expect(mockB.mockRestore).not.toHaveBeenCalled();
      expect(mockB.mockClear).toHaveBeenCalledOnce();
      expect(mockA.mockClear).not.toHaveBeenCalled();
      expect(rootMock.mockRestore).not.toHaveBeenCalled();
      expect(rootMock.mockClear).not.toHaveBeenCalled();
    });

    it("should cover every instance's mocks from the root's bulk ops", async () => {
      const { fakes, dioxusOf, mocks } = await setUp();

      await dioxusOf(fakes.root).resetAllMocks();

      for (const mock of mocks) {
        expect(mock.mockReset).toHaveBeenCalledOnce();
      }
    });

    it("should check only the instance's own mocks in isMockFunction(command), and every instance's on the root", async () => {
      const { fakes, dioxusOf } = await setUp();
      mockStore.setMock(fakes.browserB, fakeMock('dioxus.only_b'));

      expect(dioxusOf(fakes.browserA).isMockFunction('greet')).toBe(true);
      expect(dioxusOf(fakes.browserA).isMockFunction('only_b')).toBe(false);
      expect(dioxusOf(fakes.browserB).isMockFunction('only_b')).toBe(true);
      expect(dioxusOf(fakes.root).isMockFunction('only_b')).toBe(true);
    });

    it("should run the configured ops on every instance's mocks before each test", async () => {
      const { service, mocks } = await setUp({ restoreMocks: true });

      await service.beforeTest({}, {});

      for (const mock of mocks) {
        expect(mock.mockRestore).toHaveBeenCalledOnce();
      }
    });

    it("should apply an instance's own options to that instance's mocks only", async () => {
      const { service, mocks } = await setUp({}, { browserA: { restoreMocks: true } });
      const [mockA, mockB, rootMock] = mocks;

      await service.beforeTest({}, {});

      expect(mockA.mockRestore).toHaveBeenCalledOnce();
      expect(mockB.mockRestore).not.toHaveBeenCalled();
      expect(rootMock.mockRestore).not.toHaveBeenCalled();
    });

    it("should let an instance's false override the service's true", async () => {
      const { service, mocks } = await setUp({ resetMocks: true }, { browserB: { resetMocks: false } });
      const [mockA, mockB, rootMock] = mocks;

      await service.beforeTest({}, {});

      expect(mockA.mockReset).toHaveBeenCalledOnce();
      expect(mockB.mockReset).not.toHaveBeenCalled();
      expect(rootMock.mockReset).toHaveBeenCalledOnce();
    });

    it("should use an instance's own prefix, and the service's where the instance sets none", async () => {
      const { service, mocks } = await setUp(
        { clearMocks: true, clearMocksPrefix: 'fs' },
        { browserA: { clearMocksPrefix: 'gr' }, browserB: { clearMocks: true } },
      );
      const [mockA, mockB, rootMock] = mocks;

      await service.beforeTest({}, {});

      expect(mockA.mockClear).toHaveBeenCalledOnce();
      expect(mockB.mockClear).not.toHaveBeenCalled();
      expect(rootMock.mockClear).not.toHaveBeenCalled();
    });

    it("should read an instance's options from the capabilities its session requested", async () => {
      const { service, fakes, mocks } = await setUp();
      (fakes.browserB as unknown as { requestedCapabilities: unknown }).requestedCapabilities = {
        alwaysMatch: { 'wdio:dioxusServiceOptions': { restoreMocks: true } },
      };
      const [mockA, mockB] = mocks;

      await service.beforeTest({}, {});

      expect(mockB.mockRestore).toHaveBeenCalledOnce();
      expect(mockA.mockRestore).not.toHaveBeenCalled();
    });

    it('should name each instance whose mocks failed, after running the others', async () => {
      const { service, mocks } = await setUp({ restoreMocks: true });
      const [mockA, mockB, rootMock] = mocks;
      mockA.mockRestore.mockRejectedValueOnce(new Error('restore failed'));

      await expect(service.beforeTest({}, {})).rejects.toMatchObject({
        message: 'restoreAllMocks failed on browserA: mockRestore failed: dioxus.greet: restore failed',
      });
      expect(mockB.mockRestore).toHaveBeenCalledOnce();
      expect(rootMock.mockRestore).toHaveBeenCalledOnce();
    });

    describe('driverProvider', () => {
      const ranStaleMockReset = (browser: WebdriverIO.Browser | WebdriverIO.MultiRemoteBrowser) =>
        vi
          .mocked(browser.execute)
          .mock.calls.some(([script]) => typeof script === 'function' && script.name === 'clearStaleMocks');

      async function usesEnvelope(browser: WebdriverIO.Browser | WebdriverIO.MultiRemoteBrowser) {
        await (browser as unknown as Installed).dioxus.execute(() => 1);
        const [script] = vi.mocked(browser.execute).mock.lastCall ?? [];
        return String(script).includes('__wdio_value__');
      }

      it('should use the envelope and stale-mock reset only on the instances on the embedded driver', async () => {
        const { fakes } = await setUp({}, { browserB: { driverProvider: 'external' } });

        expect(ranStaleMockReset(fakes.browserA)).toBe(true);
        expect(ranStaleMockReset(fakes.browserB)).toBe(false);
        expect(await usesEnvelope(fakes.browserA)).toBe(true);
        expect(await usesEnvelope(fakes.browserB)).toBe(false);
      });

      it("should let an instance override a service-level 'external', which the root keeps", async () => {
        const { fakes } = await setUp({ driverProvider: 'external' }, { browserA: { driverProvider: 'embedded' } });

        expect(ranStaleMockReset(fakes.browserA)).toBe(true);
        expect(ranStaleMockReset(fakes.browserB)).toBe(false);
        expect(await usesEnvelope(fakes.browserA)).toBe(true);
        expect(await usesEnvelope(fakes.browserB)).toBe(false);
        expect(await usesEnvelope(fakes.root)).toBe(false);
      });
    });
  });

  describe('afterSession()', () => {
    function makeNativeBrowser(): WebdriverIO.Browser {
      return {
        isMultiremote: false,
        sessionId: 'sess-1',
        execute: vi.fn().mockResolvedValue(undefined),
        deleteSession: vi.fn().mockResolvedValue(undefined),
      } as unknown as WebdriverIO.Browser;
    }

    it('should not talk to the app or delete the session in afterSession()', async () => {
      const browser = makeNativeBrowser();
      const service = new DioxusWorkerService({}, {});
      await service.before({}, [], browser);
      vi.mocked(browser.execute).mockClear();

      await service.afterSession();

      expect(browser.execute).not.toHaveBeenCalled();
      expect(browser.deleteSession).not.toHaveBeenCalled();
    });
  });

  describe('browser mode (mode: "browser")', () => {
    it('should navigate to devServerUrl in before()', async () => {
      const browser = makeBrowserModeBrowser();
      // Capture the original url spy before overwriteCommand replaces it; the initial
      // navigation in before() runs against the original.
      const urlSpy = browser.url;

      const service = new DioxusWorkerService(
        { mode: 'browser', devServerUrl: 'http://localhost:3000' } as unknown,
        {},
      );
      await service.before({}, [], browser);

      expect(urlSpy).toHaveBeenCalledWith('http://localhost:3000');
    });

    it('should still install browser.dioxus in browser mode', async () => {
      const browser = makeBrowserModeBrowser();

      const service = new DioxusWorkerService(
        { mode: 'browser', devServerUrl: 'http://localhost:3000' } as unknown,
        {},
      );
      await service.before({}, [], browser);

      expect((browser as unknown as Installed).dioxus).toBeDefined();
    });

    it('should read devServerUrl from capability-level wdio:dioxusServiceOptions', async () => {
      const browser = makeBrowserModeBrowser();
      const urlSpy = browser.url;

      const service = new DioxusWorkerService({} as unknown, {
        'wdio:dioxusServiceOptions': { mode: 'browser', devServerUrl: 'http://localhost:4000' },
      });
      await service.before({}, [], browser);

      expect(urlSpy).toHaveBeenCalledWith('http://localhost:4000');
    });

    it('should run native setup when devServerUrl is set but browser mode is not', async () => {
      const browser = makeBrowserModeBrowser();
      const urlSpy = browser.url;

      const service = new DioxusWorkerService({} as unknown, {
        'wdio:dioxusServiceOptions': { devServerUrl: 'http://localhost:4000' },
      });
      await service.before({}, [], browser);

      expect(urlSpy).not.toHaveBeenCalled();
      expect(browser.url).toBe(urlSpy);
    });

    it('should fail clearly in browser mode without a devServerUrl', async () => {
      const service = new DioxusWorkerService({ mode: 'browser' } as unknown, {});

      await expect(service.before({}, [], makeBrowserModeBrowser())).rejects.toMatchObject({
        message: 'devServerUrl is required for browser mode but was not set',
      });
    });

    it('should override browser.url to re-inject spy after navigation', async () => {
      const browser = makeBrowserModeBrowser();

      const service = new DioxusWorkerService(
        { mode: 'browser', devServerUrl: 'http://localhost:3000' } as unknown,
        {},
      );
      await service.before({}, [], browser);

      const callsBefore = vi.mocked(browser.execute).mock.calls.length;
      await (browser as unknown as { url: (u?: string) => Promise<void> }).url('http://localhost:3000/page2');

      // After the overridden url(), execute should have been called again with the injection script
      expect(vi.mocked(browser.execute).mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });
});
