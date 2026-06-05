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
    const capsList = normaliseCaps(capabilities);
    for (const cap of capsList) {
      const options = mergeServiceOptions(this.options, getServiceOptionsFromCapability(cap));
      const platform = prepareReactNativeCapability(cap, options);
      log.info(`Prepared ${platform} capability (automationName: ${cap['appium:automationName']})`);
    }
  }

  async onWorkerStart(
    cid: string,
    capabilities: ReactNativeCapabilities | ReactNativeCapabilities[] | undefined,
  ): Promise<void> {
    if (!capabilities) {
      return;
    }
    const cap = Array.isArray(capabilities) ? capabilities[0] : capabilities;
    if (!cap) {
      return;
    }

    const device = this.#deviceManager.claim(cid);
    if (!device) {
      return;
    }

    const options = mergeServiceOptions(this.options, getServiceOptionsFromCapability(cap));
    const platform = options.platform?.toLowerCase() ?? (cap as { platformName?: string }).platformName?.toLowerCase();

    if (platform === 'android' || platform === 'ios') {
      DeviceManager.applyToCapability(cap as unknown as Record<string, unknown>, device, platform);
      log.info(`Worker ${cid}: applied device ${JSON.stringify(device)} for ${platform}`);
    }
  }

  async onWorkerEnd(cid: string): Promise<void> {
    this.#deviceManager.release(cid);
  }
}

/** Flatten WDIO's array-of-caps or multiremote object into a flat capability list. */
function normaliseCaps(
  capabilities: ReactNativeCapabilities[] | Record<string, { capabilities: ReactNativeCapabilities }>,
): ReactNativeCapabilities[] {
  if (Array.isArray(capabilities)) {
    return capabilities;
  }
  return Object.values(capabilities).map((entry) => entry.capabilities);
}
