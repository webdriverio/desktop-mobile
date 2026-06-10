// Shared main-process launcher for Appium-driven mobile services.
//
// Mobile services don't spawn a driver or the app — WDIO + @wdio/appium-service
// create the Appium session, which launches the app from capabilities. So this base
// only mutates capabilities and allocates devices from a round-robin pool. The single
// per-framework seam is `mutateCapability` (set automationName etc.). Subclasses
// (React Native, Flutter) implement it and pass their capKey + log namespace up.

import { BaseLauncher } from '@wdio/native-core';
import { createLogger } from '@wdio/native-utils';
import type { Options } from '@wdio/types';

import { type DeviceDescriptor, DeviceManager } from './deviceManager.js';
import { getServiceOptionsFromCapability, mergeServiceOptions } from './serviceConfig.js';

/** The option fields the base launcher reads; service options extend this. */
export interface MobileLauncherOptions {
  platform?: string;
  devices?: DeviceDescriptor[];
}

/** WDIO hands the launcher one of three capability shapes; normalise to a flat list. */
export function flattenCaps<TCap>(capabilities: TCap | TCap[] | Record<string, unknown>): TCap[] {
  if (Array.isArray(capabilities)) {
    return capabilities;
  }
  const values = Object.values(capabilities as Record<string, unknown>);
  // Multiremote: every value is an `{ capabilities: {...} }` wrapper.
  if (
    values.length > 0 &&
    values.every((v) => v !== null && typeof v === 'object' && 'capabilities' in (v as object))
  ) {
    return values.map((v) => (v as { capabilities: TCap }).capabilities);
  }
  // A single bare capabilities object.
  return [capabilities as TCap];
}

export abstract class MobileBaseLauncher<
  TOptions extends MobileLauncherOptions,
  TCap extends { platformName?: string },
> extends BaseLauncher {
  protected deviceManager: DeviceManager;
  protected log: ReturnType<typeof createLogger>;

  /**
   * @param options - the service global options.
   * @param capKey - the `wdio:<framework>ServiceOptions` capability key.
   * @param logNamespace - the consuming service's logger namespace (e.g. `'flutter-service'`).
   */
  constructor(
    protected options: TOptions,
    protected capKey: string,
    logNamespace: string,
  ) {
    super();
    this.deviceManager = new DeviceManager(options.devices ?? []);
    this.log = createLogger(logNamespace, 'launcher');
    this.log.debug(`Mobile launcher initialised (device pool: ${this.deviceManager.size})`);
  }

  /**
   * The one per-framework seam: set `appium:automationName` (and any other launch
   * caps) on `cap`, validate the platform, and return the resolved platform.
   * Implementations typically call `prepareMobileCapability`.
   */
  protected abstract mutateCapability(cap: TCap, options: TOptions): 'android' | 'ios';

  async onPrepare(
    _config: Options.Testrunner,
    capabilities: TCap[] | Record<string, { capabilities: TCap }>,
  ): Promise<void> {
    for (const cap of flattenCaps<TCap>(capabilities)) {
      const options = mergeServiceOptions(
        this.options,
        getServiceOptionsFromCapability<TOptions>(cap as Record<string, unknown>, this.capKey),
      );
      const platform = this.mutateCapability(cap, options);
      this.log.info(`Prepared ${platform} capability`);
    }
  }

  async onWorkerStart(cid: string, capabilities: TCap | TCap[] | Record<string, unknown> | undefined): Promise<void> {
    if (!capabilities) {
      return;
    }
    // Same flattening as onPrepare: for a multiremote run WDIO passes the
    // `{ instance: { capabilities } }` object, not an array, so a bare Array.isArray
    // check would treat the whole object as one cap and never stamp the device.
    const caps = flattenCaps<TCap>(capabilities);
    if (caps.length === 0) {
      return;
    }

    const device = this.deviceManager.claim(cid);
    if (!device) {
      return;
    }

    // One device per worker (the pool's contract). A multiremote worker shares that one
    // device across its instances — distinct-device-per-instance multiremote would need
    // the pool to allocate N devices per cid, which it doesn't do yet.
    for (const cap of caps) {
      const options = mergeServiceOptions(
        this.options,
        getServiceOptionsFromCapability<TOptions>(cap as Record<string, unknown>, this.capKey),
      );
      const platform = options.platform?.toLowerCase() ?? cap.platformName?.toLowerCase();
      if (platform === 'android' || platform === 'ios') {
        DeviceManager.applyToCapability(cap as unknown as Record<string, unknown>, device, platform);
        this.log.info(`Worker ${cid}: applied device ${JSON.stringify(device)} for ${platform}`);
      }
    }
  }

  async onWorkerEnd(cid: string): Promise<void> {
    this.deviceManager.release(cid);
  }
}
