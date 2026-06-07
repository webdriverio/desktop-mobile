import { describe, expect, it } from 'vitest';

import { DeviceManager } from '../src/deviceManager.js';

const DEVICES = [{ udid: 'd0' }, { udid: 'd1' }, { udid: 'd2' }];

describe('DeviceManager', () => {
  it('should return undefined when the pool is empty', () => {
    const dm = new DeviceManager();
    expect(dm.size).toBe(0);
    expect(dm.claim('0-0')).toBeUndefined();
  });

  it('should hand out devices round-robin by claim order', () => {
    const dm = new DeviceManager(DEVICES);
    expect(dm.claim('a')).toEqual({ udid: 'd0' });
    expect(dm.claim('b')).toEqual({ udid: 'd1' });
    expect(dm.claim('c')).toEqual({ udid: 'd2' });
    expect(dm.claim('d')).toEqual({ udid: 'd0' });
  });

  it('should NOT reuse a freed index while an earlier worker still holds it', () => {
    // Regression: a size-derived cursor would give worker C the same index as B
    // after A releases. The monotonic cursor must keep advancing.
    const dm = new DeviceManager(DEVICES);
    const a = dm.claim('a'); // d0
    const b = dm.claim('b'); // d1
    dm.release('a'); // size shrinks 2 → 1
    const c = dm.claim('c'); // must be d2, NOT d1
    expect(a).toEqual({ udid: 'd0' });
    expect(b).toEqual({ udid: 'd1' });
    expect(c).toEqual({ udid: 'd2' });
    expect(c).not.toEqual(b);
  });

  it('should apply android udid/avd onto a capability', () => {
    const cap: Record<string, unknown> = {};
    DeviceManager.applyToCapability(cap, { udid: 'emulator-5554' }, 'android');
    expect(cap['appium:udid']).toBe('emulator-5554');

    const cap2: Record<string, unknown> = {};
    DeviceManager.applyToCapability(cap2, { avd: 'Pixel_7_API_35' }, 'android');
    expect(cap2['appium:avd']).toBe('Pixel_7_API_35');
  });

  it('should apply ios udid onto a capability', () => {
    const cap: Record<string, unknown> = {};
    DeviceManager.applyToCapability(cap, { iOSUdid: 'ABC-123' }, 'ios');
    expect(cap['appium:udid']).toBe('ABC-123');
  });
});
