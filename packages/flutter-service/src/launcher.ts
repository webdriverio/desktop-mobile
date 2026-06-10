// Main-process launcher for `@wdio/flutter-service`.
//
// Flutter is an Appium-driven service (appium-flutter-driver): WDIO creates the
// Appium session, so the launcher does not spawn a driver or the app. The
// device-pool + capability-mutation orchestration lives in @wdio/native-mobile-core's
// `MobileBaseLauncher`; this subclass supplies the one per-framework seam —
// Flutter's automation name — via `mutateCapability`.

import { MobileBaseLauncher } from '@wdio/native-mobile-core';
import type { Options } from '@wdio/types';

import { prepareFlutterCapability } from './capabilities.js';
import { CUSTOM_CAPABILITY_NAME, SERVICE_NAME } from './constants.js';
import type { FlutterCapabilities, FlutterServiceGlobalOptions } from './types.js';

export default class FlutterLaunchService extends MobileBaseLauncher<FlutterServiceGlobalOptions, FlutterCapabilities> {
  constructor(options: FlutterServiceGlobalOptions, _capabilities: FlutterCapabilities, _config: Options.Testrunner) {
    super(options, CUSTOM_CAPABILITY_NAME, SERVICE_NAME);
  }

  protected mutateCapability(cap: FlutterCapabilities, options: FlutterServiceGlobalOptions): 'android' | 'ios' {
    return prepareFlutterCapability(cap, options);
  }
}
