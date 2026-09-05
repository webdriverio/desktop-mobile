import type { ElectrobunConfig } from 'electrobun';

// macOS builds with CEF (the only renderer that exposes a CDP endpoint there); Windows and Linux
// build with the native renderer — WebView2 (Chromium) over CDP on Windows, WebKitGTK over W3C
// WebDriver on Linux. No CEF off macOS: it serves no /json.
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
    // main counter window plus a second window with its own page target.
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
      bundleCEF: false,
      defaultRenderer: 'native',
    },
    linux: {
      bundleCEF: false,
      defaultRenderer: 'native',
    },
  },
} satisfies ElectrobunConfig;
