// browser.<framework>.triggerDeeplink — invokes Appium's `mobile: deepLink`
// command (the idiomatic cross-platform path since Appium 2; both UiAutomator2 and
// XCUITest implement it, and meta-drivers like appium-flutter-driver delegate to them).
// On Android, falls back to `mobile: shell` `am start` for drivers that don't expose
// `mobile: deepLink` (requires Appium relaxed security). iOS has no in-session shell,
// so an unsupported driver rethrows the original error.

import { createLogger } from '@wdio/native-utils';

const log = createLogger('native-mobile-core', 'triggerDeeplink');

/** Capability keys carrying the app id per platform (Android package / iOS bundle id). */
export interface DeeplinkCapKeys {
  android: string;
  ios: string;
}

const DEFAULT_CAP_KEYS: DeeplinkCapKeys = { android: 'appium:appPackage', ios: 'appium:bundleId' };

export async function triggerDeeplink(
  browser: WebdriverIO.Browser,
  url: string,
  capKeys: DeeplinkCapKeys = DEFAULT_CAP_KEYS,
): Promise<void> {
  log.debug(`triggerDeeplink: ${url}`);

  const caps = browser.capabilities as Record<string, unknown> & { platformName?: string };
  const platform = caps.platformName?.toLowerCase();
  // mobile: deepLink reads `package` on Android and `bundleId` on iOS; the extra key is ignored.
  const appId = (platform === 'android' ? caps[capKeys.android] : caps[capKeys.ios]) as string | undefined;

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
