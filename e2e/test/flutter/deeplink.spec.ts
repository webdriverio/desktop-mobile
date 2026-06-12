import { browser } from '@wdio/globals';

// Runs only under TEST_TYPE=deeplink (excluded from the standard run). The fixture doesn't
// register a custom URL scheme yet, so this is a smoke check that triggerDeeplink drives the
// native command path (switching to NATIVE_APP first) without error; a fuller assertion lands
// when the fixture wires a deeplink handler.
describe('browser.flutter.triggerDeeplink', () => {
  it('should issue a deeplink via the native command path', async () => {
    await browser.flutter.triggerDeeplink('wdioflutter://open/profile');
  });
});
