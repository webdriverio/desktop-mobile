import { browser } from '@wdio/globals';
import '@wdio/native-types';

// Excluded from the default run (TEST_TYPE=deeplink only): the fixture must register a
// URL scheme in its AndroidManifest for this to resolve. Kept for local/manual runs and
// the iOS fast-follow; not part of the required Android matrix yet.
describe('React Native deeplink', () => {
  it('should trigger a deeplink without throwing', async () => {
    await browser.reactNative.triggerDeeplink('reactnativee2eapp://home');
  });
});
