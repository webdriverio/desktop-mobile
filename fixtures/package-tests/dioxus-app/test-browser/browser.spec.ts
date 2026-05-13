import { browser, expect } from '@wdio/globals';

describe('Dioxus browser-mode smoke (package install)', () => {
  it('should load the page without error', async () => {
    const title = await browser.getTitle();
    expect(title).toBeDefined();
  });

  it('should have dioxus service available in browser mode', async () => {
    expect(browser.dioxus).toBeDefined();
    expect(typeof browser.dioxus.execute).toBe('function');
  });
});
