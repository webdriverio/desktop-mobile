// browser.reactNative.triggerDeeplink — invokes Appium's `mobile: deepLink`
// command (the idiomatic cross-platform path since Appium 2). Falls back to
// `adb shell am start` (Android) or `xcrun simctl openurl` (iOS) if the mobile
// command isn't supported by the driver in use.

import { createLogger } from '@wdio/native-utils';

import { SERVICE_NAME } from '../constants.js';

const log = createLogger(SERVICE_NAME, 'service');

export async function triggerDeeplink(browser: WebdriverIO.Browser, url: string): Promise<void> {
  log.debug(`triggerDeeplink: ${url}`);
  try {
    // Appium 2: UiAutomator2 + XCUITest both support mobile:deepLink.
    await (browser as WebdriverIO.Browser).execute('mobile: deepLink', { url, package: undefined });
    return;
  } catch (mobileErr) {
    log.debug(`mobile: deepLink failed (${(mobileErr as Error).message}), trying platform fallback`);
  }

  // Fallback: derive the platform from the session's capabilities.
  const caps = browser.capabilities as { platformName?: string };
  const platform = caps.platformName?.toLowerCase();

  if (platform === 'android') {
    await browser.execute('adb', ['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', url]);
  } else if (platform === 'ios') {
    // For iOS simulators — xcrun simctl openurl is the standard path.
    await browser.execute('mobile: shell', {
      command: 'xcrun',
      args: ['simctl', 'openurl', 'booted', url],
    });
  } else {
    throw new Error(
      `browser.reactNative.triggerDeeplink: unsupported platform '${caps.platformName}'. ` +
        "Use Appium's 'mobile: deepLink' directly for custom driver configurations.",
    );
  }
}
