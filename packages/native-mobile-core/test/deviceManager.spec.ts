import { describe, expect, it, vi } from 'vitest';

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('@wdio/native-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@wdio/native-utils')>();
  return { ...actual, createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() }) };
});

import { afterEach } from 'vitest';
import { applyBootCapDefaults, DeviceManager } from '../src/deviceManager.js';

describe('DeviceManager', () => {
  it('should return undefined when the pool is empty', () => {
    const dm = new DeviceManager();
    expect(dm.size).toBe(0);
    expect(dm.claim('0-0')).toBeUndefined();
  });

  it('should hand out devices round-robin and advance the cursor', () => {
    const dm = new DeviceManager([{ udid: 'a' }, { udid: 'b' }]);
    expect(dm.claim('0-0')).toEqual({ udid: 'a' });
    expect(dm.claim('0-1')).toEqual({ udid: 'b' });
  });

  it('should NOT reuse a freed index for a new worker (monotonic cursor)', () => {
    const dm = new DeviceManager([{ udid: 'a' }, { udid: 'b' }]);
    dm.claim('0-0'); // a
    dm.release('0-0');
    expect(dm.claim('0-1')).toEqual({ udid: 'b' }); // not 'a' again
  });

  it('should warn and wrap around when there are more workers than devices', () => {
    const dm = new DeviceManager([{ udid: 'a' }]);
    dm.claim('0-0');
    warn.mockClear();
    expect(dm.claim('0-1')).toEqual({ udid: 'a' });
    expect(warn).toHaveBeenCalledOnce();
  });

  it('should apply an Android udid to the capability', () => {
    const cap: Record<string, unknown> = {};
    DeviceManager.applyToCapability(cap, { udid: 'emulator-5554' }, 'android');
    expect(cap['appium:udid']).toBe('emulator-5554');
  });

  it('should apply an Android avd when no udid is given', () => {
    const cap: Record<string, unknown> = {};
    DeviceManager.applyToCapability(cap, { avd: 'Pixel_7_API_35' }, 'android');
    expect(cap['appium:avd']).toBe('Pixel_7_API_35');
  });

  it('should apply an iOS udid from iOSUdid', () => {
    const cap: Record<string, unknown> = {};
    DeviceManager.applyToCapability(cap, { iOSUdid: 'ABC-123' }, 'ios');
    expect(cap['appium:udid']).toBe('ABC-123');
  });
});

describe('applyBootCapDefaults', () => {
  const origCI = process.env.CI;
  afterEach(() => {
    if (origCI === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = origCI;
    }
  });

  it('should set autoGrantPermissions for Android', () => {
    const cap: Record<string, unknown> = {};
    applyBootCapDefaults(cap, 'android');
    expect(cap['appium:autoGrantPermissions']).toBe(true);
  });

  it('should set the iOS WDA/sim timeout defaults', () => {
    const cap: Record<string, unknown> = {};
    applyBootCapDefaults(cap, 'ios');
    expect(cap['appium:wdaLaunchTimeout']).toBe(720000);
    expect(cap['appium:simulatorStartupTimeout']).toBe(240000);
  });

  it('should set isHeadless only in CI', () => {
    process.env.CI = 'true';
    const ci: Record<string, unknown> = {};
    applyBootCapDefaults(ci, 'ios');
    expect(ci['appium:isHeadless']).toBe(true);

    delete process.env.CI;
    const local: Record<string, unknown> = {};
    applyBootCapDefaults(local, 'ios');
    expect(local['appium:isHeadless']).toBeUndefined();
  });

  it('should never override an explicit user cap', () => {
    const cap: Record<string, unknown> = { 'appium:wdaLaunchTimeout': 1, 'appium:autoGrantPermissions': false };
    applyBootCapDefaults(cap, 'ios');
    applyBootCapDefaults(cap, 'android');
    expect(cap['appium:wdaLaunchTimeout']).toBe(1);
    expect(cap['appium:autoGrantPermissions']).toBe(false);
  });

  it('should not set noReset (left to the user)', () => {
    const cap: Record<string, unknown> = {};
    applyBootCapDefaults(cap, 'android');
    applyBootCapDefaults(cap, 'ios');
    expect(cap['appium:noReset']).toBeUndefined();
  });
});
