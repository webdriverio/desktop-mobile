// Device allocation now lives in @wdio/native-mobile-core (shared with @wdio/flutter-service).
// Re-exported here so the React Native service's call sites + tests keep their local import path.

export type { DeviceDescriptor } from '@wdio/native-mobile-core';
export { DeviceManager } from '@wdio/native-mobile-core';
