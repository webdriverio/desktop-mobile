// Shared launcher / driver-lifecycle / log-capture / port-management plumbing
// consumed by @wdio/tauri-service, @wdio/electron-service, and @wdio/dioxus-service.
//
// This package is being assembled incrementally as part of PR1 (Phase 0).
// Each export below was extracted from one or both of tauri-service /
// electron-service; reconciliation notes live next to each module.

export * from './baseLauncher.js';
export * from './browserMode.js';
export * from './deeplink.js';
export * from './devServerProcess.js';
export * from './driverPool.js';
export * from './driverProcess.js';
export * from './logCapture.js';
export * from './logLevel.js';
export * from './logWriter.js';
export * from './portManager.js';
