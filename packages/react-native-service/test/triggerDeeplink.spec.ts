import { describe, expect, it, vi } from 'vitest';

import { triggerDeeplink } from '../src/commands/triggerDeeplink.js';

function fakeBrowser(capabilities: Record<string, unknown>, executeImpl?: (cmd: string, arg: unknown) => unknown) {
  const execute = vi.fn(executeImpl ?? (async () => undefined));
  return { execute, capabilities } as unknown as WebdriverIO.Browser & { execute: ReturnType<typeof vi.fn> };
}

describe('triggerDeeplink', () => {
  it('should call mobile: deepLink with the url (and bundleId on iOS)', async () => {
    const browser = fakeBrowser({ platformName: 'iOS', 'appium:bundleId': 'com.example.app' });
    await triggerDeeplink(browser, 'myapp://route');
    expect(browser.execute).toHaveBeenCalledWith('mobile: deepLink', {
      url: 'myapp://route',
      package: 'com.example.app',
      bundleId: 'com.example.app',
    });
  });

  it('should never send the literal "adb" execute command', async () => {
    const browser = fakeBrowser({ platformName: 'Android', 'appium:appPackage': 'com.example.app' });
    await triggerDeeplink(browser, 'myapp://x');
    const commands = browser.execute.mock.calls.map((c) => c[0]);
    expect(commands).not.toContain('adb');
  });

  it('should fall back to mobile: shell am start on Android when deepLink fails', async () => {
    const browser = fakeBrowser({ platformName: 'Android' }, async (cmd) => {
      if (cmd === 'mobile: deepLink') {
        throw new Error('not supported');
      }
      return undefined;
    });
    await triggerDeeplink(browser, 'myapp://y');
    expect(browser.execute).toHaveBeenLastCalledWith('mobile: shell', {
      command: 'am',
      args: ['start', '-a', 'android.intent.action.VIEW', '-d', 'myapp://y'],
    });
  });

  it('should forward -p appPackage in the am start fallback when known', async () => {
    const browser = fakeBrowser({ platformName: 'Android', 'appium:appPackage': 'com.example.app' }, async (cmd) => {
      if (cmd === 'mobile: deepLink') {
        throw new Error('not supported');
      }
      return undefined;
    });
    await triggerDeeplink(browser, 'https://example.com/x');
    expect(browser.execute).toHaveBeenLastCalledWith('mobile: shell', {
      command: 'am',
      args: ['start', '-a', 'android.intent.action.VIEW', '-d', 'https://example.com/x', '-p', 'com.example.app'],
    });
  });

  it('should rethrow on iOS when deepLink fails (no in-session shell)', async () => {
    const browser = fakeBrowser({ platformName: 'iOS' }, async () => {
      throw new Error('deepLink unsupported');
    });
    await expect(triggerDeeplink(browser, 'myapp://z')).rejects.toThrow(/deepLink unsupported/);
  });
});
