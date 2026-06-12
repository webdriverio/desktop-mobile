// Shared Appium-mobile plumbing consumed by @wdio/react-native-service and
// @wdio/flutter-service. The framework-specific JS-realm channel (RN's Hermes/CDP,
// Flutter's Dart VM Service) stays in each service package; everything here is the
// framework-agnostic Appium layer.

export type { MobileCapabilityConfig, MobileCapabilityOptions, MutableMobileCapability } from './capabilities.js';
export { prepareMobileCapability } from './capabilities.js';
export type { LogEntry } from './deviceLogs.js';
export { collectDeviceLogs, forwardDeviceLogs } from './deviceLogs.js';
export type { DeviceDescriptor } from './deviceManager.js';
export { DeviceManager } from './deviceManager.js';
export { SevereServiceError, unsupportedPlatform } from './errors.js';
export type { MobileLauncherOptions } from './launcher.js';
export { flattenCaps, MobileBaseLauncher } from './launcher.js';
export { getServiceOptionsFromCapability, mergeServiceOptions } from './serviceConfig.js';
export type { AppiumServerConnection, MobileSession, MobileSessionDeps } from './session.js';
export { createMobileSession } from './session.js';
export { listContexts, switchContext } from './switchContext.js';
export type { DeeplinkCapKeys } from './triggerDeeplink.js';
export { triggerDeeplink } from './triggerDeeplink.js';
