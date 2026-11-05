import { browser } from '@wdio/electron-service';
import { $ } from '@wdio/globals';

describe('Electron browser-mode E2E', () => {
  it('should intercept ipcRenderer.invoke via browser.electron.mock', async () => {
    const mock = await browser.electron.mock('app:get-version');
    await mock.mockResolvedValue('99.0.0-browser');

    await $('[data-testid="fetch-version"]').click();

    await browser.waitUntil(async () => (await $('[data-testid="version-output"]').getText()) === '99.0.0-browser', {
      timeout: 5000,
      timeoutMsg: 'expected mocked version to render',
    });

    await mock.update();
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('should intercept ipcRenderer.send via browser.electron.mock', async () => {
    const mock = await browser.electron.mock('action:perform');

    await $('[data-testid="send-action"]').click();

    await browser.waitUntil(async () => (await $('[data-testid="action-status"]').getText()) === 'sent', {
      timeout: 5000,
      timeoutMsg: 'expected send action to complete',
    });

    await mock.update();
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0]).toEqual([{ id: 42 }]);
  });

  it('should dispatch main → renderer events via browser.electron.emitEvent', async () => {
    // Register the listener after injection has run (page-level setup ran
    // before the injection script could replace window.electron.ipcRenderer).
    // window/document aren't in the e2e tsconfig lib, so reach them via
    // globalThis with a local type.
    type Listener = (event: unknown, payload: unknown) => void;
    type PageGlobals = {
      window: { electron: { ipcRenderer: { on: (channel: string, fn: Listener) => void } } };
      document: { querySelector: (sel: string) => { textContent: string } | null };
    };
    await browser.execute(() => {
      const g = globalThis as unknown as PageGlobals;
      g.window.electron.ipcRenderer.on('main:status', (_event, payload) => {
        const el = g.document.querySelector('[data-testid="event-output"]');
        if (el) {
          el.textContent = JSON.stringify(payload);
        }
      });
    });

    await browser.electron.emitEvent('main:status', { status: 'ready', code: 200 });

    await browser.waitUntil(
      async () => {
        const text = await $('[data-testid="event-output"]').getText();
        return text.includes('ready') && text.includes('200');
      },
      { timeout: 5000, timeoutMsg: 'expected emitted event payload to render' },
    );
  });

  it('should reset an existing mock when mock(channel) is called again', async () => {
    const mock = await browser.electron.mock('app:get-version');
    await mock.mockResolvedValue('1.0.0-before-reset');
    await $('[data-testid="fetch-version"]').click();
    await browser.waitUntil(
      async () => (await $('[data-testid="version-output"]').getText()) === '1.0.0-before-reset',
      {
        timeout: 5000,
        timeoutMsg: 'expected the mocked version to render',
      },
    );

    const again = await browser.electron.mock('app:get-version');
    await again.update();

    expect(again).toBe(mock);
    expect(again).toHaveBeenCalledTimes(0);

    await $('[data-testid="fetch-version"]').click();
    await browser.waitUntil(
      async () => (await $('[data-testid="version-output"]').getText()) !== '1.0.0-before-reset',
      {
        timeout: 5000,
        timeoutMsg: 'expected the reset mock to have no implementation',
      },
    );
    await again.update();
    expect(again).toHaveBeenCalledTimes(1);
  });

  it('should run a withImplementation callback in the page, then restore the implementation', async () => {
    type PageGlobals = {
      electron: { ipcRenderer: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> } };
    };
    const mock = await browser.electron.mock('app:get-version');
    await mock.mockResolvedValue('1.0.0-default');

    const result = await mock.withImplementation(
      () => '2.0.0-temporary',
      () => (globalThis as unknown as PageGlobals).electron.ipcRenderer.invoke('app:get-version', 'callback'),
    );

    expect(result).toBe('2.0.0-temporary');
    expect(mock.mock.calls).toEqual([['callback']]);

    await $('[data-testid="fetch-version"]').click();

    await browser.waitUntil(async () => (await $('[data-testid="version-output"]').getText()) === '1.0.0-default', {
      timeout: 5000,
      timeoutMsg: 'expected the default implementation after withImplementation',
    });
  });
});
