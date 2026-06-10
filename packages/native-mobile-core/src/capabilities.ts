import { unsupportedPlatform } from './errors.js';

/** Per-framework capability configuration injected by the consuming service. */
export interface MobileCapabilityConfig {
  /** automationName per platform — RN: UiAutomator2/XCUITest; Flutter: Flutter/Flutter. */
  automationName: { android: string; ios: string };
  /** Service package name, used only for the unsupported-platform error message. */
  serviceName: string;
}

/** The minimal capability shape this helper mutates. */
export interface MutableMobileCapability {
  platformName?: string;
  'appium:automationName'?: string;
  'appium:app'?: string;
}

/** The minimal service-options shape this helper reads. */
export interface MobileCapabilityOptions {
  platform?: string;
  appBinaryPath?: string;
}

/**
 * Resolve the Appium automation name + app capability for a mobile session and
 * validate the platform.
 *
 * Gated on the **capability's** platform (`platformName`, or the service `platform`
 * option) — never `process.platform`: a single host drives either OS over Appium,
 * and keeping the discriminator on the capability lets tests exercise both branches.
 * Mutates `capability` in place (the WDIO launcher hands the service the live caps).
 *
 * @returns the normalised platform (`'android'` | `'ios'`)
 * @throws {@link unsupportedPlatform} (a `SevereServiceError`) for anything else.
 */
export function prepareMobileCapability(
  capability: MutableMobileCapability,
  options: MobileCapabilityOptions,
  config: MobileCapabilityConfig,
): 'android' | 'ios' {
  const platformName = capability.platformName ?? options.platform;
  const platform = platformName?.toLowerCase();
  if (platform !== 'android' && platform !== 'ios') {
    throw unsupportedPlatform(platformName ?? '(unset)', config.serviceName);
  }

  capability['appium:automationName'] ??= config.automationName[platform];
  if (options.appBinaryPath && !capability['appium:app']) {
    capability['appium:app'] = options.appBinaryPath;
  }
  return platform;
}
