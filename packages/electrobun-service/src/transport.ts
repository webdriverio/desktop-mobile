// Which CDP transport drives a native-renderer Electrobun app, by platform + renderer.
//
// Electrobun's renderer is per-OS: macOS uses CEF (the only macOS renderer that serves
// a `/json` CDP endpoint — WKWebView has none), while the default `'native'` renderer maps
// to the system webview — WebView2 (Chromium) on Windows, which serves CDP once launched
// with `--remote-debugging-port`. Linux's WebKitGTK has no CDP/automation surface yet, and
// CEF-on-Windows/Linux serves no `/json`. This keeps the platform/renderer decision in one
// tested place for the launcher and the spawn path.

import type { ResolvedElectrobunApp } from './electrobunConfig.js';

/** CDP transport for driving a native-renderer Electrobun app. */
export type ElectrobunTransport = 'cef' | 'webview2';

/**
 * Decide the CDP transport for a resolved app on a platform, or `undefined` when the
 * platform/renderer has no usable CDP surface (caller fails fast).
 *
 * - macOS → `'cef'`.
 * - Windows → `'webview2'`, UNLESS the bundle is explicitly CEF (CEF-on-Windows serves no
 *   `/json`), which yields `undefined`.
 * - Linux (and anything else) → `undefined`.
 */
export function resolveTransport(
  app: ResolvedElectrobunApp,
  platform: NodeJS.Platform = process.platform,
): ElectrobunTransport | undefined {
  const renderer = app.renderer ?? '';
  if (platform === 'darwin') {
    return 'cef';
  }
  if (platform === 'win32') {
    // SPIKE (#320 CEF-on-Windows): route an explicit CEF build through the CEF transport to
    // test whether CEF-on-Windows serves /json. Normally a Windows CEF build is `undefined`
    // (unsupported). `readRenderer` records build.json's renderer as exactly 'cef' or 'native'.
    return renderer === 'cef' ? 'cef' : 'webview2';
  }
  return undefined;
}
