import type { Options } from '@wdio/types';
import { describe, expect, it, vi } from 'vitest';
import { SevereServiceError } from 'webdriverio';

// BaseLauncher carries @wdio/native-core's port/driver infra the launcher doesn't
// use yet — stub it so onPrepare is exercised in isolation.
vi.mock('@wdio/native-core', () => ({ BaseLauncher: class {} }));

import ReactNativeLaunchService from '../src/launcher.js';
import type { ReactNativeCapabilities, ReactNativeServiceGlobalOptions } from '../src/types.js';

const config = {} as Options.Testrunner;

const make = (options: ReactNativeServiceGlobalOptions = {}) =>
  new ReactNativeLaunchService(options, {} as ReactNativeCapabilities, config);

const cap = (over: Record<string, unknown> = {}): ReactNativeCapabilities =>
  ({ platformName: 'Android', ...over }) as ReactNativeCapabilities;

describe('ReactNativeLaunchService.onPrepare', () => {
  it('should set UiAutomator2 on an Android capability', async () => {
    const caps = [cap({ platformName: 'Android' })];
    await make().onPrepare(config, caps);
    expect(caps[0]['appium:automationName']).toBe('UiAutomator2');
  });

  it('should set XCUITest on an iOS capability', async () => {
    const caps = [cap({ platformName: 'iOS' })];
    await make().onPrepare(config, caps);
    expect(caps[0]['appium:automationName']).toBe('XCUITest');
  });

  it('should prepare every capability in an array', async () => {
    const caps = [cap({ platformName: 'Android' }), cap({ platformName: 'iOS' })];
    await make().onPrepare(config, caps);
    expect(caps.map((c) => c['appium:automationName'])).toEqual(['UiAutomator2', 'XCUITest']);
  });

  it('should prepare capabilities in a multiremote object', async () => {
    const caps = { phone: { capabilities: cap({ platformName: 'Android' }) } };
    await make().onPrepare(config, caps);
    expect(caps.phone.capabilities['appium:automationName']).toBe('UiAutomator2');
  });

  it('should apply the service appBinaryPath to appium:app', async () => {
    const caps = [cap({ platformName: 'Android' })];
    await make({ appBinaryPath: '/tmp/app.apk' }).onPrepare(config, caps);
    expect(caps[0]['appium:app']).toBe('/tmp/app.apk');
  });

  it('should derive the platform from the service option when platformName is unset', async () => {
    const caps = [cap({ platformName: undefined })];
    await make({ platform: 'ios' }).onPrepare(config, caps);
    expect(caps[0]['appium:automationName']).toBe('XCUITest');
  });

  it('should throw a SevereServiceError for an unsupported platform', async () => {
    const caps = [cap({ platformName: 'Windows' })];
    await expect(make().onPrepare(config, caps)).rejects.toThrow(SevereServiceError);
  });
});
