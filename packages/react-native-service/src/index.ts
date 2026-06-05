// @wdio/react-native-service — WebdriverIO service for testing React Native apps.
//
// PR1 (Foundation): the @wdio/native-cdp-bridge consumption layer — Hermes target
// selection behind Metro's inspector-proxy and the Fusebox `Origin` wiring — plus
// the public type surface re-exported from @wdio/native-types. The launcher/worker
// service, the full Metro/Hermes attach (adb reverse + foreground guard), `execute`
// and `mock` land in subsequent PRs.

export type {
  ReactNativeAPIs,
  ReactNativeBrowserExtension,
  ReactNativeCapabilities,
  ReactNativeExecuteOptions,
  ReactNativeMock,
  ReactNativeMockInstance,
  ReactNativeResult,
  ReactNativeServiceAPI,
  ReactNativeServiceCapabilitiesType,
  ReactNativeServiceGlobalOptions,
  ReactNativeServiceOptions,
  WdioReactNativeConfig,
} from '@wdio/native-types';
export * from './constants.js';
export * from './hermesBridge.js';
export * from './hermesTarget.js';
