import { browser, expect } from '@wdio/globals';

// Package-install smoke test: confirms the installed @wdio/flutter-service tarball exposes the
// expected browser.flutter.* API surface.
//
// Requires: a running Appium server + a device / emulator with the fixture app pre-installed;
// set FLUTTER_APP_PATH and optionally FLUTTER_PLATFORM, FLUTTER_DEVICE_NAME. The full feature
// matrix lives in e2e/test/flutter/.
describe('@wdio/flutter-service package install', () => {
  it('should install the browser.flutter API surface', async () => {
    expect(typeof browser.flutter.execute).toBe('function');
    expect(typeof browser.flutter.mock).toBe('function');
    expect(typeof browser.flutter.clearAllMocks).toBe('function');
    expect(typeof browser.flutter.resetAllMocks).toBe('function');
    expect(typeof browser.flutter.restoreAllMocks).toBe('function');
    expect(typeof browser.flutter.isMockFunction).toBe('function');
    expect(typeof browser.flutter.triggerDeeplink).toBe('function');
    expect(typeof browser.flutter.switchContext).toBe('function');
    expect(typeof browser.flutter.emitEvent).toBe('function');
    expect(typeof browser.flutter.byValueKey).toBe('function');
    expect(typeof browser.flutter.byText).toBe('function');
  });

  it('should invoke a registered handler via the Dart VM Service', async () => {
    // Flutter execute is the cooperative Tier-2 contract: the app under test registers named
    // handlers (the fixture app registers marker/add/bindingReady/greetAsync) — it is not arbitrary
    // Dart eval. 'bindingReady' returns true once WidgetsBinding is up, confirming the VM-Service
    // round-trip through the packed @wdio/flutter-service.
    const bindingReady = await browser.flutter.execute<boolean>('bindingReady');
    expect(bindingReady).toBe(true);
  });
});
