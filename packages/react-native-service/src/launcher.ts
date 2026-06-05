import { BaseLauncher } from '@wdio/native-core';
import { createLogger } from '@wdio/native-utils';
import type { Options } from '@wdio/types';

import { prepareReactNativeCapability } from './capabilities.js';
import { SERVICE_NAME } from './constants.js';
import { getServiceOptionsFromCapability, mergeServiceOptions } from './serviceConfig.js';
import type { ReactNativeCapabilities, ReactNativeServiceGlobalOptions } from './types.js';

const log = createLogger(SERVICE_NAME, 'launcher');

/**
 * Main-process launcher for `@wdio/react-native-service`.
 *
 * React Native is an Appium-driven service: WDIO creates the Appium session, so
 * the launcher does **not** spawn a driver or the app. Its `onPrepare` job is
 * capability mutation — resolve each capability's platform to its Appium
 * `automationName` (UiAutomator2 / XCUITest), map a service `appBinaryPath` onto
 * `appium:app`, and reject an unsupported platform with a `SevereServiceError`.
 *
 * It extends `BaseLauncher` to share `@wdio/native-core`'s infra and to host the
 * per-worker device allocation (`onWorkerStart`) that lands with the device manager.
 */
export default class ReactNativeLaunchService extends BaseLauncher {
  constructor(
    private options: ReactNativeServiceGlobalOptions,
    _capabilities: ReactNativeCapabilities,
    _config: Options.Testrunner,
  ) {
    super();
    log.debug('ReactNativeLaunchService initialised');
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
