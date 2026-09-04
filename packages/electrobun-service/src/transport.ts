// Which transport drives a native-renderer Electrobun app, by platform + renderer.
//
// Electrobun's renderer is per-OS. Two transport families:
//  - **CDP-attach** (Chromium renderers): macOS uses CEF (the only macOS renderer that serves
//    a `/json` CDP endpoint — WKWebView has none); Windows uses the native WebView2 (Chromium)
//    renderer, which serves CDP once launched with `--remote-debugging-port`.
//  - **W3C WebDriver** (WebKit renderer): Linux's native WebKitGTK renderer speaks W3C
//    WebDriver via `WebKitWebDriver` once the app opts into automation — shipped upstream in
//    electrobun 2.0.1 (#467). The driver launches the app; there is no CDP.
//
// A CEF build serves no `/json` off macOS, so CEF-on-Windows/Linux is unsupported. This keeps
// the platform/renderer decision in one tested place for the launcher and the spawn path.

import type { ResolvedElectrobunApp } from './electrobunConfig.js';

/**
 * Transport for driving a native-renderer Electrobun app.
 * - `'cef'` / `'webview2'` → CDP-attach (the service spawns the app; a Chromedriver attaches).
 * - `'webkitgtk'` → W3C WebDriver (`WebKitWebDriver` spawns the app and the worker drives it
 *   over classic WebDriver; no CDP bridge).
 */
export type ElectrobunTransport = 'cef' | 'webview2' | 'webkitgtk';

/**
 * Decide the transport for a resolved app on a platform, or `undefined` when the
 * platform/renderer has no usable automation surface (caller fails fast).
 *
 * - macOS → `'cef'`.
 * - Windows → `'webview2'`, UNLESS the bundle is explicitly CEF (CEF-on-Windows serves no
 *   `/json`), which yields `undefined`.
 * - Linux → `'webkitgtk'` for the native renderer, UNLESS the bundle is explicitly CEF
 *   (CEF-on-Linux serves no `/json`), which yields `undefined`.
 * - Anything else → `undefined`.
 */
export function resolveTransport(
  app: ResolvedElectrobunApp,
  platform: NodeJS.Platform = process.platform,
): ElectrobunTransport | undefined {
  // `readRenderer` records build.json's renderer as exactly 'cef' or 'native' (lower-cased),
  // so match the whole value rather than a substring.
  const renderer = app.renderer ?? '';
  if (platform === 'darwin') {
    return 'cef';
  }
  if (platform === 'win32') {
    // Windows drives the native WebView2 renderer; an explicit CEF build is unsupported there.
    return renderer === 'cef' ? undefined : 'webview2';
  }
  if (platform === 'linux') {
    // Linux drives the native WebKitGTK renderer over W3C WebDriver; an explicit CEF build is
    // unsupported there (serves no /json).
    return renderer === 'cef' ? undefined : 'webkitgtk';
  }
  return undefined;
}
