// React Native capability prep — a thin binding of @wdio/native-mobile-core's
// `prepareMobileCapability` with RN's per-platform automation names. The generic
// shaping/validation (automationName default, appBinaryPath→appium:app, platform
// gate, SevereServiceError) lives in the shared core.

import { prepareMobileCapability } from '@wdio/native-mobile-core';
import type { ReactNativeCapabilities, ReactNativeServiceOptions } from './types.js';

const AUTOMATION_NAME = { android: 'UiAutomator2', ios: 'XCUITest' } as const;

/**
 * Resolve the Appium automation name + app capability for a React Native session
 * and validate the platform. Mutates `capability` in place.
 *
 * @returns the normalised platform (`'android'` | `'ios'`).
 * @throws a `SevereServiceError` for an unsupported platform.
 */
export function prepareReactNativeCapability(
  capability: ReactNativeCapabilities,
  options: ReactNativeServiceOptions = {},
): 'android' | 'ios' {
  return prepareMobileCapability(capability, options, {
    automationName: AUTOMATION_NAME,
    serviceName: '@wdio/react-native-service',
  });
}
