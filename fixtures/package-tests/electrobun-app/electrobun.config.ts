import type { ElectrobunConfig } from 'electrobun';

// Reduced install-smoke fixture. macOS/Linux build with CEF; Windows builds with the
// native WebView2 (Chromium) renderer instead — the bundle matches what
// @wdio/electrobun-service attaches to over CDP on each platform.
const bundleCEF = true;

export default {
  app: {
    name: 'WDIO Electrobun App',
    identifier: 'com.wdio.electrobun.app',
    version: '0.1.0',
    urlSchemes: ['wdio-electrobun-app'],
  },
  build: {
    bun: {
      entrypoint: 'src/bun/index.ts',
    },
    views: {
      mainview: {
        entrypoint: 'src/mainview/index.ts',
      },
    },
    copy: {
      'src/mainview/index.html': 'views/mainview/index.html',
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
      bundleCEF,
      defaultRenderer: 'cef',
    },
  },
} satisfies ElectrobunConfig;
