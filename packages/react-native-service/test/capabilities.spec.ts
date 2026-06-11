import { describe, expect, it } from 'vitest';
import { SevereServiceError } from 'webdriverio';
import { prepareReactNativeCapability } from '../src/capabilities.js';
import type { ReactNativeCapabilities } from '../src/types.js';

const cap = (over: Record<string, unknown> = {}): ReactNativeCapabilities =>
  ({ platformName: 'Android', ...over }) as ReactNativeCapabilities;

describe('prepareReactNativeCapability', () => {
  it('should set UiAutomator2 and return android for an Android capability', () => {
    const c = cap({ platformName: 'Android' });
    expect(prepareReactNativeCapability(c)).toBe('android');
    expect(c['appium:automationName']).toBe('UiAutomator2');
  });

  it('should set XCUITest and return ios for an iOS capability', () => {
    const c = cap({ platformName: 'iOS' });
    expect(prepareReactNativeCapability(c)).toBe('ios');
    expect(c['appium:automationName']).toBe('XCUITest');
  });

  it('should derive the platform from the service option when platformName is unset', () => {
    const c = cap({ platformName: undefined });
    expect(prepareReactNativeCapability(c, { platform: 'ios' })).toBe('ios');
    expect(c['appium:automationName']).toBe('XCUITest');
  });

  it('should not override an automationName already set on the capability', () => {
    const c = cap({ platformName: 'Android', 'appium:automationName': 'XCUITest' });
    prepareReactNativeCapability(c);
    expect(c['appium:automationName']).toBe('XCUITest');
  });

  it('should map appBinaryPath onto appium:app', () => {
    const c = cap({ platformName: 'Android' });
    prepareReactNativeCapability(c, { appBinaryPath: '/tmp/app.apk' });
    expect(c['appium:app']).toBe('/tmp/app.apk');
  });

  it('should not override an explicit appium:app', () => {
    const c = cap({ platformName: 'Android', 'appium:app': '/explicit.apk' });
    prepareReactNativeCapability(c, { appBinaryPath: '/tmp/app.apk' });
    expect(c['appium:app']).toBe('/explicit.apk');
  });

  it('should throw a SevereServiceError for an unsupported platform', () => {
    const c = cap({ platformName: 'Windows' });
    expect(() => prepareReactNativeCapability(c)).toThrow(SevereServiceError);
    expect(() => prepareReactNativeCapability(c)).toThrow(/Android and iOS only/);
  });

  it('should throw a SevereServiceError when no platform is set', () => {
    const c = cap({ platformName: undefined });
    expect(() => prepareReactNativeCapability(c)).toThrow(SevereServiceError);
  });
});
