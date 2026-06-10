// Error helpers for the React Native service.
//
// `SevereServiceError` (re-exported from webdriverio) tells the WDIO runner the
// failure is non-recoverable and the run should abort — used when a capability
// fundamentally can't work, e.g. it targets a platform the service doesn't support.

import { SevereServiceError } from 'webdriverio';

export { SevereServiceError };

/**
 * Thrown by the launcher when a capability targets a platform the service does
 * not support. React Native automation runs on Android (UiAutomator2) and iOS
 * (XCUITest) only.
 */
export function unsupportedPlatform(platform: string): Error {
  return new SevereServiceError(
    `@wdio/react-native-service supports Android and iOS only (received platformName: '${platform}'). ` +
      "Set platformName to 'Android' or 'iOS' in your capabilities.",
  );
}
