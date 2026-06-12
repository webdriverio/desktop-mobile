import { describe, expect, it } from 'vitest';
import { SevereServiceError } from 'webdriverio';

import { prepareFlutterCapability } from '../src/capabilities.js';
import type { FlutterCapabilities } from '../src/types.js';

const cap = (over: Record<string, unknown> = {}): FlutterCapabilities =>
  ({ platformName: 'Android', ...over }) as FlutterCapabilities;

describe('prepareFlutterCapability', () => {
  it('should set automationName Flutter and return android for an Android capability', () => {
    const c = cap({ platformName: 'Android' });
    expect(prepareFlutterCapability(c)).toBe('android');
    expect(c['appium:automationName']).toBe('Flutter');
  });

  it('should set automationName Flutter and return ios for an iOS capability', () => {
    const c = cap({ platformName: 'iOS' });
    expect(prepareFlutterCapability(c)).toBe('ios');
    expect(c['appium:automationName']).toBe('Flutter');
  });

  it('should derive the platform from the service option when platformName is unset', () => {
    const c = cap({ platformName: undefined });
    expect(prepareFlutterCapability(c, { platform: 'iOS' })).toBe('ios');
  });

  it('should map appBinaryPath onto appium:app', () => {
    const c = cap({ platformName: 'Android' });
    prepareFlutterCapability(c, { appBinaryPath: '/tmp/app.apk' });
    expect(c['appium:app']).toBe('/tmp/app.apk');
  });

  it('should throw a SevereServiceError for an unsupported platform', () => {
    const c = cap({ platformName: 'Windows' as unknown as 'Android' });
    expect(() => prepareFlutterCapability(c)).toThrow(SevereServiceError);
    expect(() => prepareFlutterCapability(c)).toThrow(/@wdio\/flutter-service/);
  });
});
