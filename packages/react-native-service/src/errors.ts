// Error helpers for the React Native service.
//
// `unsupportedPlatform` is shared with @wdio/flutter-service via @wdio/native-mobile-core
// (bound here to RN's package name); `hermesUnavailable` is RN/Hermes-specific.

import { unsupportedPlatform as coreUnsupportedPlatform } from '@wdio/native-mobile-core';
import { SevereServiceError } from 'webdriverio';

export { SevereServiceError };

/**
 * Thrown by the launcher when a capability targets a platform the service does
 * not support. React Native automation runs on Android (UiAutomator2) and iOS
 * (XCUITest) only.
 */
export function unsupportedPlatform(platform: string): Error {
  return coreUnsupportedPlatform(platform, '@wdio/react-native-service');
}

/**
 * Returned (rejected) when `execute`/`mock` is used but the app's Hermes
 * inspector is not reachable through Metro. These features need a debug/Metro
 * build with the Hermes engine and the inspector-proxy running; native find/tap
 * works without it.
 */
export function hermesUnavailable(host: string, port: number): Error {
  return new Error(
    `Could not reach the React Native Hermes inspector via Metro at ${host}:${port}. ` +
      'browser.reactNative.execute / mock require a debug (Metro) build with the Hermes engine and ' +
      'the Metro inspector-proxy running. Start Metro and ensure the app is foregrounded ' +
      '(Android also needs `adb reverse tcp:<port> tcp:<port>`).',
  );
}
