import { browser } from '@wdio/globals';

describe('Dioxus visual regression', () => {
  it('should match the app baseline screenshot', async () => {
    // Wait for the app to be fully rendered
    await browser.waitUntil(
      async () => {
        const el = await browser.$('#app-title');
        return el.isDisplayed();
      },
      { timeout: 10000, timeoutMsg: 'app-title not visible within 10 s' },
    );

    await browser.saveScreen('dioxus-app-baseline');
  });
});
