// @wdio/react-native-service entry point.
//
// - Default export: the worker-side service (registered automatically by the
//   WDIO test runner via `services: ['@wdio/react-native-service']`).
// - Named `launcher` export: the main-process launch service (auto-detected by
//   the runner via the standard WDIO service convention).
//
// The bare import pulls in @wdio/native-types' ambient module augmentation so
// `browser.reactNative.*` and `wdio:reactNativeServiceOptions` are typed for
// consumers. Only config-time types are re-exported (mirroring the sibling
// services) — the API/mock types reach users through the augmentation.
import '@wdio/native-types';

export type {
  ReactNativeCapabilities,
  ReactNativeServiceGlobalOptions,
  ReactNativeServiceOptions,
} from '@wdio/native-types';
export { default as launcher } from './launcher.js';
export { default } from './service.js';
export { cleanup as cleanupWdioSession, createReactNativeCapabilities, init as startWdioSession } from './session.js';
