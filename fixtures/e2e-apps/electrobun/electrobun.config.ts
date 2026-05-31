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
