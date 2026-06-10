// Standalone (`remote()`) session helpers for @wdio/flutter-service.
//
// The init/cleanup orchestration lives in @wdio/native-mobile-core's `createMobileSession`
// factory; this binds it to Flutter's launcher + worker classes. `createFlutterCapabilities`
// stays local (it bakes in the Flutter custom-capability key).

import type { AppiumServerConnection } from '@wdio/native-mobile-core';
import { createMobileSession } from '@wdio/native-mobile-core';

import { CUSTOM_CAPABILITY_NAME, SERVICE_NAME } from './constants.js';
import FlutterLaunchService from './launcher.js';
import FlutterWorkerService from './service.js';
import type { FlutterCapabilities, FlutterServiceGlobalOptions } from './types.js';

export type { AppiumServerConnection };

const session = createMobileSession<FlutterServiceGlobalOptions, FlutterCapabilities>({
  LauncherClass: FlutterLaunchService,
  WorkerClass: FlutterWorkerService,
  logNamespace: SERVICE_NAME,
});

/**
 * Create a Flutter standalone session. Drives launcher.onPrepare (capability mutation),
 * opens the Appium session, and installs `browser.flutter.*`. Appium itself is expected
 * to be running; `connection` overrides its address (defaults to `localhost:4723/`).
 */
export const init = session.init;

/** Clean up a standalone Flutter session created by {@link init}. */
export const cleanup = session.cleanup;

/** Build a minimal FlutterCapabilities object for standalone use. */
export function createFlutterCapabilities(
  platformName: 'Android' | 'iOS',
  serviceOptions?: FlutterCapabilities['wdio:flutterServiceOptions'],
): FlutterCapabilities {
  return {
    platformName,
    [CUSTOM_CAPABILITY_NAME]: serviceOptions,
  } as FlutterCapabilities;
}
