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
 * Thrown by the launcher in native mode when the current platform/renderer has no usable
 * automation surface — an explicit CEF build off macOS (serves no `/json`), or a non-desktop
 * platform. Fails fast with an actionable message rather than a cryptic attach timeout.
 */
export function nativeRendererUnsupportedPlatform(
  platform: NodeJS.Platform = process.platform,
  renderer?: string,
): Error {
  const cefOffMac = (platform === 'win32' || platform === 'linux') && renderer === 'cef';
  return new SevereServiceError(
    `@wdio/electrobun-service cannot drive this Electrobun app in native mode on ${platform}` +
      (renderer ? ` (renderer: ${renderer})` : '') +
      '. Supported native renderers: macOS via CEF, Windows via the WebView2 system renderer (CDP), ' +
      'Linux via the native WebKitGTK renderer (W3C WebDriver, electrobun >= 2.0.1). ' +
      (cefOffMac
        ? `A CEF build exposes no /json endpoint on ${platform} — build with the native renderer instead ` +
          '(bundleCEF: false / defaultRenderer: "native"), which is the Electrobun default.'
        : "This platform has no automation surface — run on macOS/Windows/Linux, or use browser mode (mode: 'browser')."),
  );
}

/**
 * Thrown by the launcher when driving the Linux WebKitGTK renderer but the `WebKitWebDriver`
 * binary (from the `webkit2gtk-driver` package) can't be found. The W3C transport spawns this
 * driver to launch and drive the app, so it is a hard prerequisite on Linux.
 */
export function webKitWebDriverNotFound(): Error {
  return new SevereServiceError(
    '@wdio/electrobun-service could not find WebKitWebDriver, required to drive the Linux WebKitGTK ' +
      'renderer over W3C WebDriver. Install it with `sudo apt-get install webkit2gtk-driver` ' +
      '(Debian/Ubuntu; `dnf install webkit2gtk-driver`, `pacman -S webkit2gtk-driver`, or your ' +
      "distribution's equivalent), or put WebKitWebDriver on PATH.",
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
