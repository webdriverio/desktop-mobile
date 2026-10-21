import { browser, expect } from '@wdio/globals';

async function errorOf(action: Promise<unknown>) {
  return action.then(
    () => undefined,
    (error: Error) => error,
  );
}

// Until #741 captures elements natively, the embedded driver refuses element screenshots.
describe('Dioxus screenshots (embedded)', () => {
  it('should refuse element screenshots rather than return a blank image', async () => {
    const unsupported = /element screenshots are not supported by the Dioxus embedded driver/;
    expect((await errorOf(browser.$('#app-title').takeScreenshot()))?.message).toMatch(unsupported);
  });
});
