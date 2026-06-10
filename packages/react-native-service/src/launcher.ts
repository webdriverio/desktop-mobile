// Main-process launcher for `@wdio/react-native-service`.
//
// React Native is an Appium-driven service: WDIO creates the Appium session, so
// the launcher does not spawn a driver or the app. The device-pool + capability-
// mutation orchestration lives in @wdio/native-mobile-core's `MobileBaseLauncher`;
// this subclass supplies the one per-framework seam — RN's automation names — via
// `mutateCapability`.

import { MobileBaseLauncher } from '@wdio/native-mobile-core';
import type { Options } from '@wdio/types';

import { prepareReactNativeCapability } from './capabilities.js';
import { CUSTOM_CAPABILITY_NAME, SERVICE_NAME } from './constants.js';
import type { ReactNativeCapabilities, ReactNativeServiceGlobalOptions } from './types.js';

export default class ReactNativeLaunchService extends MobileBaseLauncher<
  ReactNativeServiceGlobalOptions,
  ReactNativeCapabilities
> {
  constructor(
    options: ReactNativeServiceGlobalOptions,
    _capabilities: ReactNativeCapabilities,
    _config: Options.Testrunner,
  ) {
    super(options, CUSTOM_CAPABILITY_NAME, SERVICE_NAME);
  }

  protected mutateCapability(
    cap: ReactNativeCapabilities,
    options: ReactNativeServiceGlobalOptions,
  ): 'android' | 'ios' {
    return prepareReactNativeCapability(cap, options);
  }
}
