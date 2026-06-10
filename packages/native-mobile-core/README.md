# @wdio/native-mobile-core

Shared Appium-mobile plumbing for WebdriverIO native mobile services.

This package holds the framework-agnostic layer every Appium-driven mobile service needs — the
device pool, capability preparation, the launcher base class, context switching, deeplink, and
device-log capture — so consumers (`@wdio/react-native-service`, `@wdio/flutter-service`, …) don't
duplicate it. The framework-specific JS-realm channel (RN's Hermes/CDP, Flutter's Dart VM Service)
stays in each service package.

Internal to this monorepo; consumed as a `workspace:*` dependency.

## Exports

- `DeviceManager`, `DeviceDescriptor` — round-robin device pool for parallel workers / multiremote.
- `MobileBaseLauncher` — `BaseLauncher` subclass owning the pool + the `onPrepare`/`onWorkerStart`/`onWorkerEnd` hooks; subclasses implement the one per-framework seam `mutateCapability`.
- `prepareMobileCapability` — per-platform `appium:automationName` + `appBinaryPath`→`appium:app` + platform validation.
- `mergeServiceOptions`, `getServiceOptionsFromCapability` — generic option merge / per-capability option read.
- `triggerDeeplink` — `mobile: deepLink` (+ Android `am start` fallback).
- `switchWindow`, `listWindows` — Appium context switching (`NATIVE_APP` ↔ `WEBVIEW_*` / `FLUTTER`).
- `collectDeviceLogs`, `forwardDeviceLogs`, `LogEntry` — native device logs (`logcat`/`syslog`).
- `createMobileSession` — standalone (`remote()`) session factory.
- `unsupportedPlatform`, `SevereServiceError` — shared error helpers.
