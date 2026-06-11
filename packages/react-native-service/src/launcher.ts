import { BaseLauncher } from '@wdio/native-core';
import { createLogger } from '@wdio/native-utils';
import type { Options } from '@wdio/types';

import { prepareReactNativeCapability } from './capabilities.js';
import { SERVICE_NAME } from './constants.js';
import { DeviceManager } from './deviceManager.js';
import { getServiceOptionsFromCapability, mergeServiceOptions } from './serviceConfig.js';
import type { ReactNativeCapabilities, ReactNativeServiceGlobalOptions } from './types.js';

const log = createLogger(SERVICE_NAME, 'launcher');

/**
 * Main-process launcher for `@wdio/react-native-service`.
 *
 * React Native is an Appium-driven service: WDIO creates the Appium session, so
 * the launcher does **not** spawn a driver or the app. Its jobs:
 * - `onPrepare`: mutate capabilities (automationName, appBinaryPath→appium:app).
 * - `onWorkerStart`: claim a device from the pool and set appium:udid/avd on the cap.
 * - `onWorkerEnd`: release the claimed device back to the pool.
 */
export default class ReactNativeLaunchService extends BaseLauncher {
  #deviceManager: DeviceManager;

  constructor(
    private options: ReactNativeServiceGlobalOptions,
    _capabilities: ReactNativeCapabilities,
    _config: Options.Testrunner,
  ) {
    super();
    this.#deviceManager = new DeviceManager(options.devices ?? []);
    log.debug(`ReactNativeLaunchService initialised (device pool: ${this.#deviceManager.size})`);
  }

  async onPrepare(
    _config: Options.Testrunner,
    capabilities: ReactNativeCapabilities[] | Record<string, { capabilities: ReactNativeCapabilities }>,
  ): Promise<void> {
    for (const cap of flattenCaps(capabilities)) {
      const options = mergeServiceOptions(this.options, getServiceOptionsFromCapability(cap));
      const platform = prepareReactNativeCapability(cap, options);
      log.info(`Prepared ${platform} capability (automationName: ${cap['appium:automationName']})`);
    }
  }

  async onWorkerStart(
    cid: string,
    capabilities: ReactNativeCapabilities | ReactNativeCapabilities[] | Record<string, unknown> | undefined,
  ): Promise<void> {
    if (!capabilities) {
      return;
    }
    // Use the same flattening as onPrepare: for a multiremote run WDIO passes the
    // `{ instance: { capabilities } }` object, not an array, so a bare Array.isArray
    // check would treat the whole object as one cap and never stamp the device.
    const caps = flattenCaps(capabilities);
    if (caps.length === 0) {
      return;
    }

    const device = this.#deviceManager.claim(cid);
    if (!device) {
      return;
    }

    // One device per worker (the pool's contract). A multiremote worker shares that one
    // device across its instances — distinct-device-per-instance multiremote would need
    // the pool to allocate N devices per cid, which it doesn't do yet.
    for (const cap of caps) {
      const options = mergeServiceOptions(this.options, getServiceOptionsFromCapability(cap));
      const platform =
        options.platform?.toLowerCase() ?? (cap as { platformName?: string }).platformName?.toLowerCase();
      if (platform === 'android' || platform === 'ios') {
        DeviceManager.applyToCapability(cap as unknown as Record<string, unknown>, device, platform);
        log.info(`Worker ${cid}: applied device ${JSON.stringify(device)} for ${platform}`);
      }
    }
  }

  async onWorkerEnd(cid: string): Promise<void> {
    this.#deviceManager.release(cid);
  }
}

/**
 * Flatten WDIO's three capability shapes into a flat list of capability objects:
 * an array of caps, a multiremote `{ instance: { capabilities } }` object, or a single
 * bare W3C capabilities object (the onWorkerStart shape for a standard run).
 */
function flattenCaps(
  capabilities: ReactNativeCapabilities | ReactNativeCapabilities[] | Record<string, unknown>,
): ReactNativeCapabilities[] {
  if (Array.isArray(capabilities)) {
    return capabilities;
  }
  const values = Object.values(capabilities as Record<string, unknown>);
  // Multiremote: every value is an `{ capabilities: {...} }` wrapper.
  if (
    values.length > 0 &&
    values.every((v) => v !== null && typeof v === 'object' && 'capabilities' in (v as object))
  ) {
    return values.map((v) => (v as { capabilities: ReactNativeCapabilities }).capabilities);
  }
  // A single bare capabilities object.
  return [capabilities as ReactNativeCapabilities];
}
