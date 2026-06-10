// Error helpers for the Flutter service.
//
// `unsupportedPlatform` is shared via @wdio/native-mobile-core (bound here to the
// Flutter package name); `vmServiceUnavailable` is Flutter/Dart-VM-specific.

import { unsupportedPlatform as coreUnsupportedPlatform } from '@wdio/native-mobile-core';
import { SevereServiceError } from 'webdriverio';

export { SevereServiceError };

/**
 * Thrown by the launcher when a capability targets a platform the service does not
 * support. Flutter automation runs on Android and iOS (appium-flutter-driver) only.
 */
export function unsupportedPlatform(platform: string): Error {
  return coreUnsupportedPlatform(platform, '@wdio/flutter-service');
}

/**
 * Returned (rejected) when `execute`/`mock` is used but the app's Dart VM Service is
 * not reachable. These features need a debug/profile build with `enableFlutterDriverExtension()`
 * called before `runApp()`; native find/tap works without the VM-service attach.
 */
export function vmServiceUnavailable(host: string, detail: string): Error {
  return new Error(
    `Could not reach the Flutter app's Dart VM Service at ${host} (${detail}). ` +
      'browser.flutter.execute / mock require a debug or profile build with ' +
      '`enableFlutterDriverExtension()` called before `runApp()`, and the VM Service ' +
      'port reachable (set `appium:dartVmServicePort` to pin it on CI).',
  );
}
