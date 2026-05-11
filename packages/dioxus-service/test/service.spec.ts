import { describe, expect, it, vi } from 'vitest';

import DioxusWorkerService from '../src/service.js';

function makeBrowser(): WebdriverIO.Browser {
  return { execute: vi.fn() } as unknown as WebdriverIO.Browser;
}

describe('DioxusWorkerService', () => {
  it('should install browser.dioxus on before()', async () => {
    const browser = makeBrowser();
    const service = new DioxusWorkerService({}, {});

    await service.before({}, [], browser);

    expect((browser as unknown as { dioxus: { execute: unknown } }).dioxus).toBeDefined();
    expect(typeof (browser as unknown as { dioxus: { execute: unknown } }).dioxus.execute).toBe('function');
  });

  it('should route browser.dioxus.execute through the underlying browser.execute', async () => {
    const browser = makeBrowser();
    vi.mocked(browser.execute).mockResolvedValueOnce('out');

    const service = new DioxusWorkerService({}, {});
    await service.before({}, [], browser);

    const result = await (browser as unknown as { dioxus: { execute: (s: string) => Promise<string> } }).dioxus.execute(
      'return 1',
    );

    expect(result).toBe('out');
    expect(browser.execute).toHaveBeenCalledWith('return 1');
  });
});
