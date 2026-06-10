// Flutter capability prep — a thin binding of @wdio/native-mobile-core's
// `prepareMobileCapability` with Flutter's automation name. appium-flutter-driver
// registers as automationName `Flutter` on BOTH platforms (it's a meta-driver that
// wraps UiAutomator2/XCUITest internally).

import { prepareMobileCapability } from '@wdio/native-mobile-core';
import type { FlutterCapabilities, FlutterServiceOptions } from './types.js';

const AUTOMATION_NAME = { android: 'Flutter', ios: 'Flutter' } as const;

/**
 * Resolve the Appium automation name + app capability for a Flutter session and
 * validate the platform. Mutates `capability` in place.
 *
 * @returns the normalised platform (`'android'` | `'ios'`).
 * @throws a `SevereServiceError` for an unsupported platform.
 */
export function prepareFlutterCapability(
  capability: FlutterCapabilities,
  options: FlutterServiceOptions = {},
): 'android' | 'ios' {
  return prepareMobileCapability(capability, options, {
    automationName: AUTOMATION_NAME,
    serviceName: '@wdio/flutter-service',
  });
}
