import path from 'node:path';
import { getElectronBinaryPath } from '@wdio/electron-service';
import type { Options } from '@wdio/types';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

// Force onPrepare's last-resort binary probe: a fork `browserVersion` the map can't resolve, plus an
// explicit binary path (a fork version would break auto-detection). The session boots only if the
// probe reads Chromium off the packaged binary.
// See https://github.com/webdriverio/desktop-mobile/issues/578
const appBinaryPath = await getElectronBinaryPath(__dirname);

export const config: Options.Testrunner = {
  runner: 'local',
  specs: ['./test/probe.spec.ts'],
  exclude: [],
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'electron',
      browserVersion: '1000.0.0-probe',
    },
  ],
  logLevel: 'trace',
  outputDir: './logs',
  logLevels: {
    webdriver: 'trace',
    '@wdio/utils': 'trace',
    '@wdio/electron-service': 'trace',
  },
  bail: 0,
  baseUrl: '',
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  autoXvfb: true,
  services: [['electron', { appBinaryPath }]],
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },
  tsConfigPath: path.join(__dirname, 'tsconfig.json'),
};
