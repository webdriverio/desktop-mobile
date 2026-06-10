import { describe, expect, it } from 'vitest';
import { SevereServiceError } from 'webdriverio';

import { prepareMobileCapability } from '../src/capabilities.js';

const CONFIG = {
  automationName: { android: 'UiAutomator2', ios: 'XCUITest' },
  serviceName: '@wdio/test-service',
};

const cap = (over: Record<string, unknown> = {}) => ({ platformName: 'Android', ...over });

describe('prepareMobileCapability', () => {
  it('should set the Android automationName and return android', () => {
    const c = cap({ platformName: 'Android' });
    expect(prepareMobileCapability(c, {}, CONFIG)).toBe('android');
    expect(c['appium:automationName']).toBe('UiAutomator2');
  });

  it('should set the iOS automationName and return ios', () => {
    const c = cap({ platformName: 'iOS' });
    expect(prepareMobileCapability(c, {}, CONFIG)).toBe('ios');
    expect(c['appium:automationName']).toBe('XCUITest');
  });

  it('should derive the platform from the service option when platformName is unset', () => {
    const c = cap({ platformName: undefined });
    expect(prepareMobileCapability(c, { platform: 'ios' }, CONFIG)).toBe('ios');
    expect(c['appium:automationName']).toBe('XCUITest');
  });

  it('should respect a per-framework automationName map (e.g. Flutter)', () => {
    const c = cap({ platformName: 'Android' });
    prepareMobileCapability(c, {}, { automationName: { android: 'Flutter', ios: 'Flutter' }, serviceName: 'x' });
    expect(c['appium:automationName']).toBe('Flutter');
  });

  it('should not override an automationName already set on the capability', () => {
    const c = cap({ platformName: 'Android', 'appium:automationName': 'Custom' });
    prepareMobileCapability(c, {}, CONFIG);
    expect(c['appium:automationName']).toBe('Custom');
  });

  it('should map appBinaryPath onto appium:app', () => {
    const c = cap({ platformName: 'Android' });
    prepareMobileCapability(c, { appBinaryPath: '/tmp/app.apk' }, CONFIG);
    expect(c['appium:app']).toBe('/tmp/app.apk');
  });

  it('should not override an explicit appium:app', () => {
    const c = cap({ platformName: 'Android', 'appium:app': '/explicit.apk' });
    prepareMobileCapability(c, { appBinaryPath: '/tmp/app.apk' }, CONFIG);
    expect(c['appium:app']).toBe('/explicit.apk');
  });

  it('should throw a SevereServiceError naming the service for an unsupported platform', () => {
    const c = cap({ platformName: 'Windows' });
    expect(() => prepareMobileCapability(c, {}, CONFIG)).toThrow(SevereServiceError);
    expect(() => prepareMobileCapability(c, {}, CONFIG)).toThrow(/@wdio\/test-service/);
    expect(() => prepareMobileCapability(c, {}, CONFIG)).toThrow(/Android and iOS only/);
  });

  it('should throw when no platform is set anywhere', () => {
    const c = cap({ platformName: undefined });
    expect(() => prepareMobileCapability(c, {}, CONFIG)).toThrow(SevereServiceError);
  });
});
