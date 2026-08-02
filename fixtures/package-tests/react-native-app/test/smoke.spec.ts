import { browser, expect } from '@wdio/globals';

// Package-install smoke test: confirms the installed @wdio/react-native-service tarball
// exposes the expected browser.reactNative.* API surface.
//
// Requires: a running Appium server + a device / emulator with the fixture APK or .app
// pre-installed; set RN_APP_PATH and optionally RN_PLATFORM, RN_DEVICE_NAME.
// The full feature matrix lives in e2e/test/react-native/.
describe('@wdio/react-native-service package install', () => {
  it('should install the browser.reactNative API surface', async () => {
    expect(typeof browser.reactNative.execute).toBe('function');
    expect(typeof browser.reactNative.mock).toBe('function');
    expect(typeof browser.reactNative.clearAllMocks).toBe('function');
    expect(typeof browser.reactNative.resetAllMocks).toBe('function');
    expect(typeof browser.reactNative.restoreAllMocks).toBe('function');
    expect(typeof browser.reactNative.isMockFunction).toBe('function');
    expect(typeof browser.reactNative.triggerDeeplink).toBe('function');
    expect(typeof browser.reactNative.switchContext).toBe('function');
    expect(typeof browser.reactNative.emitEvent).toBe('function');
  });

  it('should find a native element via accessibility id', async () => {
    // Locate the counter display by its testID (→ accessibilityIdentifier / resource-id).
    const counter = await browser.$('~counter');
    expect(await counter.isDisplayed()).toBe(true);
  });

  it('should execute JavaScript in the Hermes realm', async () => {
    const inHermes = await browser.reactNative.execute((rn) => typeof rn.HermesInternal !== 'undefined');
    expect(inHermes).toBe(true);
  });
});
