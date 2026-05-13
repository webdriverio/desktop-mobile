import { browser, expect } from '@wdio/globals';

describe('Dioxus deeplink', () => {
  it('should trigger a deeplink without throwing', async () => {
    // triggerDeeplink invokes the OS handler — we verify no error is thrown.
    // Full deeplink round-trip requires a registered protocol handler (not in CI baseline).
    await expect(browser.dioxus.triggerDeeplink('wdiotest://ping')).resolves.not.toThrow();
  });
});
