import { browser, expect } from '@wdio/globals';
import '@wdio/native-types';

// React Native "windows" are Appium contexts (NATIVE_APP, WEBVIEW_*).
describe('React Native contexts', () => {
  it('should list at least the native context', async () => {
    const windows = await browser.reactNative.listContexts();
    expect(Array.isArray(windows)).toBe(true);
    expect(windows).toContain('NATIVE_APP');
  });

  it('should switch to the native context', async () => {
    await browser.reactNative.switchContext('NATIVE_APP');
    expect(await browser.reactNative.listContexts()).toContain('NATIVE_APP');
  });
});
