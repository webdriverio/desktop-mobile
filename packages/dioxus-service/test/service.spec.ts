import { afterEach, describe, expect, it, vi } from 'vitest';
import mockStore from '../src/mockStore.js';
import DioxusWorkerService from '../src/service.js';

function makeBrowser(): WebdriverIO.Browser {
  return { execute: vi.fn().mockResolvedValue(undefined) } as unknown as WebdriverIO.Browser;
}

type Installed = {
  dioxus: {
    execute: (s: string) => Promise<unknown>;
    mock: (command: string) => Promise<unknown>;
    clearAllMocks: (prefix?: string) => Promise<void>;
    resetAllMocks: (prefix?: string) => Promise<void>;
    restoreAllMocks: (prefix?: string) => Promise<void>;
    isMockFunction: (x: unknown) => boolean;
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

  it('should clear the process-wide mockStore in after()', async () => {
    const fakeMock = { getMockName: () => 'dioxus.greet' };
    // biome-ignore lint/suspicious/noExplicitAny: test-only cast
    mockStore.setMock(fakeMock as any);
    expect(mockStore.getMocks()).toHaveLength(1);

    const service = new DioxusWorkerService({}, {});
    await service.after();

    expect(mockStore.getMocks()).toHaveLength(0);
  });
});
