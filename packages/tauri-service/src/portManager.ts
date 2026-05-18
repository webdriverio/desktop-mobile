// Tauri re-export shim around @wdio/native-core/portManager.
//
// The actual implementation moved to @wdio/native-core. This file exists
// so existing Tauri call sites continue importing from `./portManager.js`
// without churn. It can be deleted later once those imports are updated to
// reach native-core directly.

export { PortManager, type PortPair } from '@wdio/native-core';
