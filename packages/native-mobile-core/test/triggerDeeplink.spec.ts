import { describe, expect, it, vi } from 'vitest';

import { triggerDeeplink } from '../src/triggerDeeplink.js';

const makeBrowser = (caps: Record<string, unknown>, execute: ReturnType<typeof vi.fn>) =>
  ({ capabilities: caps, execute }) as unknown as WebdriverIO.Browser;

describe('triggerDeeplink', () => {
  it('should call mobile: deepLink with the Android package', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    await triggerDeeplink(makeBrowser({ platformName: 'Android', 'appium:appPackage': 'com.app' }, execute), 'app://x');
    expect(execute).toHaveBeenCalledWith('mobile: deepLink', {
      url: 'app://x',
      package: 'com.app',
      bundleId: 'com.app',
    });
  });

  it('should call mobile: deepLink with the iOS bundleId', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    await triggerDeeplink(makeBrowser({ platformName: 'iOS', 'appium:bundleId': 'com.app' }, execute), 'app://x');
    expect(execute).toHaveBeenCalledWith('mobile: deepLink', {
      url: 'app://x',
      package: 'com.app',
      bundleId: 'com.app',
    });
  });

  it('should pass only the url when no app id is known', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    await triggerDeeplink(makeBrowser({ platformName: 'Android' }, execute), 'app://x');
    expect(execute).toHaveBeenCalledWith('mobile: deepLink', { url: 'app://x' });
  });

  it('should fall back to `am start` on Android when mobile: deepLink fails', async () => {
    const execute = vi.fn().mockRejectedValueOnce(new Error('no deepLink')).mockResolvedValueOnce(undefined);
    await triggerDeeplink(makeBrowser({ platformName: 'Android', 'appium:appPackage': 'com.app' }, execute), 'app://x');
    expect(execute).toHaveBeenLastCalledWith('mobile: shell', {
      command: 'am',
      args: ['start', '-a', 'android.intent.action.VIEW', '-d', 'app://x', '-p', 'com.app'],
    });
  });

  it('should rethrow on iOS when mobile: deepLink fails (no in-session shell)', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(
      triggerDeeplink(makeBrowser({ platformName: 'iOS', 'appium:bundleId': 'com.app' }, execute), 'app://x'),
    ).rejects.toThrow('boom');
  });

  it('should honour custom capability keys', async () => {
    const execute = vi.fn().mockResolvedValue(undefined);
    await triggerDeeplink(makeBrowser({ platformName: 'Android', 'appium:appId': 'com.custom' }, execute), 'app://x', {
      android: 'appium:appId',
      ios: 'appium:bundleId',
    });
    expect(execute).toHaveBeenCalledWith('mobile: deepLink', {
      url: 'app://x',
      package: 'com.custom',
      bundleId: 'com.custom',
    });
  });
});
