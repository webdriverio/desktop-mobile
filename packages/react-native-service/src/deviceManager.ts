// Device allocation for parallel workers / multiremote.
//
// Each worker claims one device from a round-robin pool derived from the configured
// device list. Claimed devices are released on worker end. The pool is intentionally
// simple: no retries, no priority weighting — just index-based fair distribution so
// N workers map 1-to-1 onto N devices when the list is long enough.
//
// For a single-worker run (or when no device list is configured) the pool is a no-op:
// the capability is used as-is and Appium picks the device.

import { createLogger } from '@wdio/native-utils';

import { SERVICE_NAME } from './constants.js';

const log = createLogger(SERVICE_NAME, 'launcher');

export interface DeviceDescriptor {
  /** Android: `adb devices` UDID (e.g. 'emulator-5554', 'R38M1234ABCD') */
  udid?: string;
  /** Android emulator: AVD name (e.g. 'Pixel_7_API_35') — used when udid is unset */
  avd?: string;
  /** iOS: device UDID from `xcrun simctl list` */
  iOSUdid?: string;
}

export class DeviceManager {
  #devices: DeviceDescriptor[];
  #claimed = new Map<string, number>(); // cid → index
  // Monotonic cursor — NOT derived from #claimed.size, which shrinks on release() and
  // would hand a freed index to a new worker while an earlier one still holds it.
  #nextIndex = 0;

  constructor(devices: DeviceDescriptor[] = []) {
    this.#devices = devices;
  }

  get size(): number {
    return this.#devices.length;
  }

  /**
   * Claim the next available device for `cid`. Returns the descriptor, or
   * `undefined` when the pool is empty (single-device / unconfigured flow).
   */
  claim(cid: string): DeviceDescriptor | undefined {
    if (this.#devices.length === 0) {
      return undefined;
    }
    const index = this.#nextIndex % this.#devices.length;
    this.#nextIndex += 1;
    this.#claimed.set(cid, index);
    const device = this.#devices[index];
    log.debug(`Worker ${cid}: claimed device[${index}] ${JSON.stringify(device)}`);
    return device;
  }

  release(cid: string): void {
    this.#claimed.delete(cid);
  }

  /**
   * Apply a claimed device descriptor onto an Appium capability object.
   * Android: sets appium:udid (emulator serial) or appium:avd (AVD name).
   * iOS: sets appium:udid from iOSUdid.
   */
  static applyToCapability(
    capability: Record<string, unknown>,
    device: DeviceDescriptor,
    platform: 'android' | 'ios',
  ): void {
    if (platform === 'android') {
      if (device.udid) {
        capability['appium:udid'] = device.udid;
      } else if (device.avd) {
        capability['appium:avd'] = device.avd;
      }
    } else if (platform === 'ios' && device.iOSUdid) {
      capability['appium:udid'] = device.iOSUdid;
    }
  }
}
