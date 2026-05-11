import { describe, expect, it, vi } from 'vitest';

import DioxusWorkerService from '../src/service.js';

function makeBrowser(): WebdriverIO.Browser {
  return { execute: vi.fn() } as unknown as WebdriverIO.Browser;
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
    vi.mocked(browser.execute).mockResolvedValueOnce('out');

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
});
