// @wdio/electrobun-cdp-bridge — multi-target CDP client for Electrobun's CEF
// renderer: discovers every content webview target, labels them, and routes
// commands to the active target (backing switchWindow/listWindows). Never
// issues Page.navigate on attach.

export * from './bridge.js';
export * from './connection.js';
export * from './constants.js';
export * from './devTool.js';
export * from './targetRegistry.js';
export * from './types.js';
