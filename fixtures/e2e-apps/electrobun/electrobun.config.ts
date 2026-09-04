import type { ElectrobunConfig } from 'electrobun';

// macOS builds with CEF — the renderer that exposes a CDP endpoint there; the service pins
// the remote-debugging port into the built bundle's build.json at launch. Windows and Linux
// build with the native renderer: Windows = WebView2 (Chromium) over CDP (the service injects
// --remote-debugging-port via WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS); Linux = WebKitGTK over
// W3C WebDriver (WebKitWebDriver, electrobun >= 2.0.1). No CEF off macOS — it serves no /json.
const bundleCEF = true;

export default {
  app: {
    name: 'WDIO Electrobun E2E',
    identifier: 'com.wdio.electrobun.e2e',
    version: '0.1.0',
    urlSchemes: ['wdio-electrobun'],
  },
  build: {
    bun: {
      entrypoint: 'src/bun/index.ts',
    },
    // Two views drive the multi-window surface (switchWindow / listWindows): the
    // main counter window plus a second window with its own CEF page target.
    views: {
      mainview: {
        entrypoint: 'src/mainview/index.ts',
      },
      secondview: {
        entrypoint: 'src/secondview/index.ts',
      },
    },
    copy: {
      'src/mainview/index.html': 'views/mainview/index.html',
      'src/secondview/index.html': 'views/secondview/index.html',
    },
    mac: {
      bundleCEF,
      defaultRenderer: 'cef',
    },
    win: {
      // Native WebView2 (Chromium) renderer — driven over CDP by @wdio/electrobun-service
      // via an injected --remote-debugging-port. No CEF bundle on Windows.
      bundleCEF: false,
      defaultRenderer: 'native',
    },
    linux: {
      // Native WebKitGTK renderer — driven over W3C WebDriver (WebKitWebDriver) by
      // @wdio/electrobun-service once the app opts into automation (electrobun 2.0.1, #467).
      // No CEF on Linux (it serves no /json).
      bundleCEF: false,
      defaultRenderer: 'native',
    },
  },
} satisfies ElectrobunConfig;
