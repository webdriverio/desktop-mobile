import { $ } from '@wdio/globals';
import { browser } from '@wdio/tauri-service';

describe('Browser-mode smoke (Tauri package install)', () => {
  it('should mock a Tauri command and surface the mocked response in the page', async () => {
    const mock = await browser.tauri.mock('get_info');
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
