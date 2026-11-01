import { browser, expect } from '@wdio/globals';

async function errorOf(action: Promise<unknown>) {
  return action.then(
    () => undefined,
    (error: Error) => error,
  );
}

// Until #741 captures the webview natively, the embedded driver refuses screenshots.
describe('Dioxus screenshots (embedded)', () => {
  it('should refuse page and element screenshots rather than return a blank image', async () => {
    const unsupported = /screenshots are not supported by the Dioxus embedded driver/;
    expect((await errorOf(browser.takeScreenshot()))?.message).toMatch(unsupported);
    expect((await errorOf(browser.$('#app-title').takeScreenshot()))?.message).toMatch(unsupported);
  });
});
