// Shared error helpers for Appium-driven mobile services.
//
// `SevereServiceError` (re-exported from webdriverio) tells the WDIO runner the
// failure is non-recoverable and the run should abort — used when a capability
// fundamentally can't work, e.g. it targets a platform the service doesn't support.

import { SevereServiceError } from 'webdriverio';

export { SevereServiceError };

/**
 * Thrown by a mobile launcher when a capability targets a platform the service
 * does not support. Appium mobile services run on Android (UiAutomator2) and iOS
 * (XCUITest) only.
 *
 * @param platform - the offending `platformName` (or `(unset)`).
 * @param serviceName - the consuming service's package name, for a clear message.
 */
export function unsupportedPlatform(platform: string, serviceName = 'this mobile service'): Error {
  return new SevereServiceError(
    `${serviceName} supports Android and iOS only (received platformName: '${platform}'). ` +
      "Set platformName to 'Android' or 'iOS' in your capabilities.",
  );
}
