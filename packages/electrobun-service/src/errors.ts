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
 * Thrown by the launcher in native mode on Linux/Windows. CEF-rendered Electrobun
 * apps are only automatable on macOS in the 0.x line: on Linux/Windows, CEF's
 * failed-`persist:default`-profile fallback serves no `/json`, so Chromedriver can
 * never attach (an upstream electrobun/CEF limitation, not fixable from the service).
 * Fail fast with an actionable message rather than letting the user hit a cryptic
 * CDP-attach timeout. Native-renderer (WebView2/WebKitGTK) support that would cover
 * these platforms is a planned follow-up — webdriverio/desktop-mobile#317.
 */
export function cefNativeModeMacOnly(platform: NodeJS.Platform = process.platform): Error {
  return new SevereServiceError(
    '@wdio/electrobun-service can only automate CEF-rendered Electrobun apps on macOS in this ' +
      `0.x release (current platform: ${platform}). On Linux and Windows, CEF does not expose a ` +
      'reachable Chrome DevTools Protocol endpoint (an upstream limitation), so the app cannot be ' +
      "driven over CDP. Run your Electrobun e2e tests on macOS, or use browser mode (mode: 'browser') " +
      'against a dev server. Native-renderer (WebView2/WebKitGTK) support for Windows/Linux is a ' +
      'planned follow-up — see https://github.com/webdriverio/desktop-mobile/issues/317.',
  );
}

/**
 * Returned (rejected) by `triggerDeeplink` on platforms where Electrobun does
 * not yet support custom URL schemes. v1 supports macOS only (schemes are
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
