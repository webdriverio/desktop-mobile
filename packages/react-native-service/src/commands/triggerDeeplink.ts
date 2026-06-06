// browser.reactNative.triggerDeeplink — invokes Appium's `mobile: deepLink`
// command (the idiomatic cross-platform path since Appium 2; both UiAutomator2 and
// XCUITest implement it). On Android, falls back to `mobile: shell` `am start` for
// drivers that don't expose `mobile: deepLink` (requires Appium relaxed security).
// iOS has no in-session shell, so an unsupported driver rethrows the original error.

import { createLogger } from '@wdio/native-utils';

import { SERVICE_NAME } from '../constants.js';

const log = createLogger(SERVICE_NAME, 'service');

export async function triggerDeeplink(browser: WebdriverIO.Browser, url: string): Promise<void> {
  log.debug(`triggerDeeplink: ${url}`);

  const caps = browser.capabilities as {
    platformName?: string;
    'appium:appPackage'?: string;
    'appium:bundleId'?: string;
  };
  const platform = caps.platformName?.toLowerCase();
  // mobile: deepLink reads `package` on Android and `bundleId` on iOS; the extra key is ignored.
  const appId = platform === 'android' ? caps['appium:appPackage'] : caps['appium:bundleId'];

  try {
    await browser.execute('mobile: deepLink', appId ? { url, package: appId, bundleId: appId } : { url });
    return;
  } catch (mobileErr) {
    if (platform !== 'android') {
      throw mobileErr;
    }
    log.debug(`mobile: deepLink failed (${(mobileErr as Error).message}), falling back to am start`);
  }

  // Android best-effort fallback: am start the VIEW intent via the device shell.
  // Forward the resolved package (-p) when known so http/https links open the test app
  // directly instead of raising an app chooser; custom schemes resolve without it.
  await browser.execute('mobile: shell', {
    command: 'am',
    args: ['start', '-a', 'android.intent.action.VIEW', '-d', url, ...(appId ? ['-p', appId] : [])],
  });
}
