import { afterEach, describe, expect, it, vi } from 'vitest';
import mockStore from '../src/mockStore.js';
import DioxusWorkerService from '../src/service.js';

function makeBrowser(): WebdriverIO.Browser {
  return { execute: vi.fn().mockResolvedValue(undefined) } as unknown as WebdriverIO.Browser;
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
    execute: (s: string) => Promise<unknown>;
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
    // First call: the injection script (handled by service.before).
    // Second call: the dioxus.execute under test — return 'out'.
    vi.mocked(browser.execute).mockResolvedValueOnce(undefined).mockResolvedValueOnce('out');

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

  it('should leave the mockStore intact in after() so afterSession() can restore mocks', async () => {
    const fakeMock = { getMockName: () => 'dioxus.greet' };
    // biome-ignore lint/suspicious/noExplicitAny: test-only cast
    mockStore.setMock(fakeMock as any);
    expect(mockStore.getMocks()).toHaveLength(1);

    const service = new DioxusWorkerService({}, {});
    await service.after();

    expect(mockStore.getMocks()).toHaveLength(1);
  });

  it('should clear the process-wide mockStore in afterSession()', async () => {
    const fakeMock = { getMockName: () => 'dioxus.greet', mockRestore: vi.fn().mockResolvedValue(undefined) };
    // biome-ignore lint/suspicious/noExplicitAny: test-only cast
    mockStore.setMock(fakeMock as any);
    expect(mockStore.getMocks()).toHaveLength(1);

    const service = new DioxusWorkerService({}, {});
    await service.afterSession();

    expect(fakeMock.mockRestore).toHaveBeenCalled();
    expect(mockStore.getMocks()).toHaveLength(0);
  });

  it('should still clear the mockStore in afterSession() when mockRestore() rejects', async () => {
    // Simulates a closed browser session: browser.execute() in the
    // unregistration script rejects, restoreAllMocks() bubbles the failure.
    // The stale entry MUST still be evicted so the next session doesn't see it.
    const fakeMock = {
      getMockName: () => 'dioxus.greet',
      mockRestore: vi.fn().mockRejectedValue(new Error('session closed')),
    };
    // biome-ignore lint/suspicious/noExplicitAny: test-only cast
    mockStore.setMock(fakeMock as any);

    const service = new DioxusWorkerService({}, {});
    await service.afterSession();

    expect(fakeMock.mockRestore).toHaveBeenCalled();
    expect(mockStore.getMocks()).toHaveLength(0);
  });

  describe('afterSession() session teardown', () => {
    function makeNativeBrowser(deleteSession: () => Promise<void>): WebdriverIO.Browser {
      return {
        isMultiremote: false,
        sessionId: 'sess-1',
        execute: vi.fn().mockResolvedValue(undefined),
        deleteSession: vi.fn(deleteSession),
      } as unknown as WebdriverIO.Browser;
    }

    it('should delete the session when one is present', async () => {
      const browser = makeNativeBrowser(() => Promise.resolve());
      const service = new DioxusWorkerService({}, {});
      await service.before({}, [], browser);

      await service.afterSession();

      expect(browser.deleteSession).toHaveBeenCalledTimes(1);
    });

    it('should swallow a benign "Session not found" error instead of rethrowing', async () => {
      // The Windows flake: deleteSession sees the session already gone; left to
      // propagate it triggers a retry that closes the socket and crashes libuv.
      const browser = makeNativeBrowser(() => Promise.reject(new Error('Session not found')));
      const service = new DioxusWorkerService({}, {});
      await service.before({}, [], browser);

      await expect(service.afterSession()).resolves.toBeUndefined();
      expect(browser.deleteSession).toHaveBeenCalledTimes(1);
    });

    it('should swallow a connection-closed (UND_ERR_CLOSED) error during teardown', async () => {
      const closed = Object.assign(new Error('other side closed'), { code: 'UND_ERR_CLOSED' });
      const browser = makeNativeBrowser(() => Promise.reject(closed));
      const service = new DioxusWorkerService({}, {});
      await service.before({}, [], browser);

      await expect(service.afterSession()).resolves.toBeUndefined();
    });

    it('should not hang when deleteSession never settles (bounded by timeout)', async () => {
      vi.useFakeTimers();
      try {
        const browser = makeNativeBrowser(() => new Promise<void>(() => {}));
        const service = new DioxusWorkerService({}, {});
        await service.before({}, [], browser);

        const pending = service.afterSession();
        await vi.advanceTimersByTimeAsync(10_000);

        await expect(pending).resolves.toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
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
