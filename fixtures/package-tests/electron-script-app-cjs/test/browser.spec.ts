import { browser } from '@wdio/electron-service';
import { $ } from '@wdio/globals';

describe('Browser-mode smoke (CJS package install)', () => {
  it('should mock an IPC channel and surface the mocked response in the page', async () => {
    const mock = await browser.electron.mock('get-info');
    await mock.mockResolvedValue({ name: 'BrowserModeApp', version: '0.0.0' });

    await $('[data-testid="fetch-info"]').click();

    await browser.waitUntil(
      async () => {
        const text = await $('[data-testid="info"]').getText();
        return text.includes('BrowserModeApp');
      },
      { timeout: 5000, timeoutMsg: 'expected mocked info to render' },
    );

    await mock.update();
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
