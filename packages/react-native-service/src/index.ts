// @wdio/react-native-service — WebdriverIO service for testing React Native apps.
//
// PR1 (Foundation): the @wdio/native-cdp-bridge consumption layer — Hermes target
// selection behind Metro's inspector-proxy and the Fusebox `Origin` wiring. The
// launcher/worker service, the full Metro/Hermes attach (adb reverse + foreground
// guard), `execute` and `mock` land in subsequent PRs.
//
// The bare import pulls in @wdio/native-types' ambient module augmentation so
// `browser.reactNative.*` and `wdio:reactNativeServiceOptions` are typed for
// consumers. Only the config-time types are re-exported (mirroring the sibling
// services) — the API/mock types reach users through the augmentation, not a
// direct import.
import '@wdio/native-types';

export type {
  ReactNativeCapabilities,
  ReactNativeServiceGlobalOptions,
  ReactNativeServiceOptions,
} from '@wdio/native-types';
export * from './constants.js';
export * from './hermesBridge.js';
export * from './hermesTarget.js';
