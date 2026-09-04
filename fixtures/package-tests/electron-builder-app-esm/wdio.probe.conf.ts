import path from 'node:path';
import { getElectronBinaryPath } from '@wdio/electron-service';
import type { Options } from '@wdio/types';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

// Resolve the real packaged binary up front (using the actually-installed Electron version), then
// hand it to the service explicitly. Paired with a fork `browserVersion` that the Electron→Chromium
// map cannot resolve, this forces onPrepare's last-resort binary probe (#578): the session only
// boots if the probe reads the Chromium version off the packaged binary — otherwise onPrepare
// throws before any session starts.
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
