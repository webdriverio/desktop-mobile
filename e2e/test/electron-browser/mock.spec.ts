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
    await browser.execute(() => {
      window.electron.ipcRenderer.on('main:status', (_event, payload) => {
        document.querySelector('[data-testid="event-output"]').textContent = JSON.stringify(payload);
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
});
