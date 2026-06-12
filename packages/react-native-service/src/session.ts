// Standalone (`remote()`) session helpers for @wdio/react-native-service.
//
// The init/cleanup orchestration (drive launcher.onPrepare, open the Appium session,
// install the worker surface) lives in @wdio/native-mobile-core's `createMobileSession`
// factory; this binds it to RN's launcher + worker classes. `createReactNativeCapabilities`
// stays RN-local (it bakes in the RN custom-capability key).

import type { AppiumServerConnection } from '@wdio/native-mobile-core';
import { createMobileSession } from '@wdio/native-mobile-core';

import { CUSTOM_CAPABILITY_NAME, SERVICE_NAME } from './constants.js';
import ReactNativeLaunchService from './launcher.js';
import ReactNativeWorkerService from './service.js';
import type { ReactNativeCapabilities, ReactNativeServiceGlobalOptions } from './types.js';

export type { AppiumServerConnection };

const session = createMobileSession<ReactNativeServiceGlobalOptions, ReactNativeCapabilities>({
  LauncherClass: ReactNativeLaunchService,
  WorkerClass: ReactNativeWorkerService,
  logNamespace: SERVICE_NAME,
});

/**
 * Create a React Native standalone session. Drives launcher.onPrepare (capability
 * mutation) then opens the Appium session and installs `browser.reactNative.*`.
 * Appium itself is expected to be running; `connection` overrides its address
 * (defaults to `localhost:4723/`).
 */
export const init = session.init;

/** Clean up a standalone React Native session created by {@link init}. */
export const cleanup = session.cleanup;

/**
 * Build a minimal ReactNativeCapabilities object for standalone use.
 */
export function createReactNativeCapabilities(
  platformName: 'Android' | 'iOS',
  serviceOptions?: ReactNativeCapabilities['wdio:reactNativeServiceOptions'],
): ReactNativeCapabilities {
  return {
    platformName,
    [CUSTOM_CAPABILITY_NAME]: serviceOptions,
  } as ReactNativeCapabilities;
}
