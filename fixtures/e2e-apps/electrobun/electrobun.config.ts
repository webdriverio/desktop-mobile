import type { ElectrobunConfig } from 'electrobun';

// CEF renderer is mandatory on every OS: it is the only renderer that exposes a
// CDP endpoint, which is how @wdio/electrobun-service attaches. The service pins
// the remote-debugging port into the built bundle's build.json at launch, so no
// port is hardcoded here.
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
      // Bounded CEF-on-CI probe (PR4 gated window/deeplink legs). The CEF
      // chrome-runtime logs "Cannot create profile" for the persist:default
      // partition that BrowserWindow forces, so both webviews fall back to the
      // shared global context and the second window's renderer browser-info
      // response times out. Ask Chromium to initialise its profile cleanly under
      // automation (skip first-run / default-browser prompts) before deciding to
      // gate these legs as a documented CEF gap.
      chromiumFlags: {
        'no-first-run': true,
        'no-default-browser-check': true,
      },
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
