import { unsupportedPlatform } from './errors.js';
import type { ReactNativeCapabilities, ReactNativeServiceOptions } from './types.js';

const AUTOMATION_NAME = { android: 'UiAutomator2', ios: 'XCUITest' } as const;

/**
 * Resolve the Appium automation name + app capability for a React Native session
 * and validate the platform.
 *
 * Gated on the **capability's** platform (`platformName`, or the service `platform`
 * option) — never `process.platform`: a single host drives either OS over Appium,
 * and keeping the discriminator on the capability lets tests exercise both branches.
 * Mutates `capability` in place (the WDIO launcher hands the service the live caps).
 *
 * @returns the normalised platform (`'android'` | `'ios'`)
 * @throws {@link unsupportedPlatform} (a `SevereServiceError`) for anything else.
 */
export function prepareReactNativeCapability(
  capability: ReactNativeCapabilities,
  options: ReactNativeServiceOptions = {},
): 'android' | 'ios' {
  const platformName = (capability as { platformName?: string }).platformName ?? options.platform;
  const platform = platformName?.toLowerCase();
  if (platform !== 'android' && platform !== 'ios') {
    throw unsupportedPlatform(platformName ?? '(unset)');
  }

  capability['appium:automationName'] ??= AUTOMATION_NAME[platform];
  if (options.appBinaryPath && !capability['appium:app']) {
    capability['appium:app'] = options.appBinaryPath;
  }
  return platform;
}
