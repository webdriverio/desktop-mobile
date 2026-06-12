// @wdio/flutter-service entry point.
//
// - Default export: the worker-side service (registered by the WDIO test runner via
//   `services: ['appium', 'flutter']`).
// - Named `launcher` export: the main-process launch service.
//
// The bare import pulls in @wdio/native-types' ambient module augmentation so
// `browser.flutter.*` and `wdio:flutterServiceOptions` are typed for consumers.
import '@wdio/native-types';

export type { FlutterCapabilities, FlutterServiceGlobalOptions, FlutterServiceOptions } from '@wdio/native-types';
export { default as launcher } from './launcher.js';
export { default } from './service.js';
export { cleanup as cleanupWdioSession, createFlutterCapabilities, init as startWdioSession } from './session.js';
