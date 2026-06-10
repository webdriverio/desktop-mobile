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
