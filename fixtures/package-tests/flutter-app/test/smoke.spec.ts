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
    expect(typeof browser.flutter.switchWindow).toBe('function');
    expect(typeof browser.flutter.emitEvent).toBe('function');
    expect(typeof browser.flutter.byValueKey).toBe('function');
    expect(typeof browser.flutter.byText).toBe('function');
  });

  it('should evaluate a Dart expression via the VM Service', async () => {
    const isFlutter = await browser.flutter.execute<boolean>('WidgetsBinding.instance != null');
    expect(isFlutter).toBe(true);
  });
});
