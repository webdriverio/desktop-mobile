import type { ElectrobunConfig } from 'electrobun';

// macOS + Linux build with CEF — the renderer that exposes a CDP endpoint there; the
// service pins the remote-debugging port into the built bundle's build.json at launch.
// Windows builds with the native WebView2 (Chromium) renderer instead: it serves CDP via
// --remote-debugging-port, which the service injects through the
// WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS env var — no CEF (CEF-on-Windows serves no /json).
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
      // SPIKE (#320 CEF-on-Windows): build CEF on Windows too, to test whether CEF serves
      // /json there. Normally Windows is native WebView2 (bundleCEF:false/'native').
      bundleCEF,
      defaultRenderer: 'cef',
    },
    linux: {
      bundleCEF,
      defaultRenderer: 'cef',
    },
  },
} satisfies ElectrobunConfig;
