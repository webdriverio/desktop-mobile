import { $, browser, expect } from '@wdio/globals';

describe('Dioxus browser-mode smoke (package install)', () => {
  it('should load the page without error', async () => {
    const title = await browser.getTitle();
    expect(title).toBeDefined();
  });

  it('should have dioxus service available in browser mode', async () => {
    expect(browser.dioxus).toBeDefined();
    expect(typeof browser.dioxus.execute).toBe('function');
  });

  it('should mock a Dioxus command and surface the mocked response in the page', async () => {
    const mock = await browser.dioxus.mock('get_info');
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
