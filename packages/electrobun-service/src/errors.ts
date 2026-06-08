// Error helpers for the Electrobun service.
//
// `SevereServiceError` (re-exported from webdriverio) tells the WDIO runner the
// failure is non-recoverable and the run should abort — used when a config
// fundamentally can't work, e.g. the app wasn't built with the CEF renderer so
// no CDP endpoint exists to attach to.

import { SevereServiceError } from 'webdriverio';

export { SevereServiceError };

/**
 * Thrown by the launcher when the Electrobun app under test was not built with
 * the CEF renderer. The default WebKit webviews (WKWebView on macOS, WebKitGTK
 * on Linux) expose no Chrome DevTools Protocol endpoint, so a CDP-attach service
 * cannot drive them — the app must build with `defaultRenderer: 'cef'` /
 * `bundleCEF: true` in `electrobun.config.ts`.
 */
export function cefRendererRequired(platform: NodeJS.Platform = process.platform): Error {
  return new SevereServiceError(
    '@wdio/electrobun-service requires the Electrobun app to be built with the CEF renderer ' +
      "(set defaultRenderer: 'cef' / bundleCEF: true for the target OS in electrobun.config.ts). " +
      `The default system webview on ${platform} does not expose a Chrome DevTools Protocol ` +
      'endpoint, so the app cannot be automated over CDP. See the @wdio/electrobun-service README ' +
      'for the renderer requirement and the supported-platform matrix.',
  );
}

/**
 * Thrown by the launcher in native mode when the current platform has no usable CDP
 * surface for the app's renderer. Driven native renderers: macOS via CEF, Windows via
 * the WebView2 (Chromium) system renderer over CDP. Linux's WebKitGTK exposes no
 * CDP/automation surface yet, and a CEF build on Windows/Linux serves no `/json`. Fail
 * fast with an actionable message rather than letting the user hit a cryptic CDP-attach
 * timeout.
 */
export function nativeRendererUnsupportedPlatform(
  platform: NodeJS.Platform = process.platform,
  renderer?: string,
): Error {
  return new SevereServiceError(
    `@wdio/electrobun-service cannot drive this Electrobun app in native mode on ${platform}` +
      (renderer ? ` (renderer: ${renderer})` : '') +
      '. Supported native renderers: macOS via CEF, Windows via the WebView2 system renderer (CDP). ' +
      'Linux (WebKitGTK) has no CDP/automation surface yet — tracked in ' +
      'https://github.com/webdriverio/desktop-mobile/issues/317. On Windows, build with the native ' +
      'renderer (bundleCEF: false / defaultRenderer: "native"); a CEF build there exposes no /json ' +
      "endpoint. Otherwise run on macOS, or use browser mode (mode: 'browser').",
  );
}

/**
 * Returned (rejected) by `triggerDeeplink` on platforms where Electrobun does
 * not yet support custom URL schemes. 0.x supports macOS only (schemes are
 * registered via the generated `Info.plist`); Windows/Linux are a documented
 * gap pending upstream support.
 */
export function deeplinkUnsupportedOnPlatform(platform: NodeJS.Platform = process.platform): Error {
  return new Error(
    `triggerDeeplink is only supported on macOS in this release (current platform: ${platform}). ` +
      'Electrobun custom URL schemes are registered via Info.plist on macOS; Windows/Linux deeplink ' +
      'support is pending upstream and is tracked as a known gap.',
  );
}
