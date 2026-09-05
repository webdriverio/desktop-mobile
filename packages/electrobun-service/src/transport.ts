// Transport by platform + renderer. macOS → CEF (WKWebView exposes no CDP); Windows → native
// WebView2 (Chromium/CDP); Linux → native WebKitGTK over W3C WebDriver (electrobun 2.0.1, #467).
// A CEF build serves no `/json` off macOS, so CEF-on-Windows/Linux is unsupported.

import type { ResolvedElectrobunApp } from './electrobunConfig.js';

export type ElectrobunTransport = 'cef' | 'webview2' | 'webkitgtk';

export function resolveTransport(
  app: ResolvedElectrobunApp,
  platform: NodeJS.Platform = process.platform,
): ElectrobunTransport | undefined {
  const renderer = app.renderer ?? '';
  if (platform === 'darwin') {
    return 'cef';
  }
  if (platform === 'win32') {
    return renderer === 'cef' ? undefined : 'webview2';
  }
  if (platform === 'linux') {
    return renderer === 'cef' ? undefined : 'webkitgtk';
  }
  return undefined;
}
