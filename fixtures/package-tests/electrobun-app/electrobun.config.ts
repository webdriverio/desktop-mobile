import type { ElectrobunConfig } from 'electrobun';

// Reduced install-smoke fixture: a single CEF window. CEF is still enabled so the
// bundle matches what @wdio/electrobun-service attaches to over CDP.
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
      bundleCEF,
      defaultRenderer: 'cef',
    },
    linux: {
      bundleCEF,
      defaultRenderer: 'cef',
    },
  },
} satisfies ElectrobunConfig;
