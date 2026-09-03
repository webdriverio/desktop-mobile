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

const log = createLogger('native-mobile-core', 'launcher');

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
    // Warn only on genuine contention *at this instant* — when every device is currently
    // held. Gating on #nextIndex (monotonic, never resets) would false-positive on the
    // first claim after a full round of workers has released their devices.
    if (this.#claimed.size >= this.#devices.length) {
      log.warn(
        `More workers than configured devices (${this.#devices.length}): worker ${cid} will share ` +
          `device[${this.#nextIndex % this.#devices.length}] with another worker.`,
      );
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

/**
 * Apply robustness + iOS-launch cap defaults, **only when the user hasn't set them** (an
 * explicit cap always wins — same contract as `applyToCapability`). The iOS timeout/headless
 * values mirror the proven e2e config: without them a real user hits the exact cryptic
 * appium-xcuitest timeout this exists to kill.
 *
 * Deliberately omits `appium:noReset`: its value trades app-state isolation for speed in a
 * way that should be the user's explicit choice, and the repo's e2e suite doesn't rely on it.
 */
export function applyBootCapDefaults(capability: Record<string, unknown>, platform: 'android' | 'ios'): void {
  const setIfUnset = (key: string, value: unknown) => {
    if (capability[key] === undefined) {
      capability[key] = value;
    }
  };

  if (platform === 'android') {
    // Auto-dismiss runtime-permission dialogs that otherwise block the UI tree.
    setIfUnset('appium:autoGrantPermissions', true);
    return;
  }

  // iOS: generous ceilings for a cold WDA build / slow sim boot; tighten by pinning a
  // prebuilt WDA (derivedDataPath + usePrebuiltWDA) yourself.
  setIfUnset('appium:wdaLaunchTimeout', 720000);
  setIfUnset('appium:simulatorStartupTimeout', 240000);
  // CI boots the sim headless (simctl); without isHeadless, XCUITest restarts it with the
  // window visible — a slow re-boot that raced simulatorStartupTimeout. A local run wants
  // the visible window.
  // https://github.com/webdriverio/desktop-mobile/issues/359
  if (process.env.CI) {
    setIfUnset('appium:isHeadless', true);
  }
}
