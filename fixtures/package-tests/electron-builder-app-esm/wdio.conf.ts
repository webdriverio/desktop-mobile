import path from 'node:path';
import type { Options } from '@wdio/types';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

export const config: Options.Testrunner = {
  runner: 'local',
  specs: ['./test/**/*.spec.ts'],
  // The probe scenario has its own config, wdio.probe.conf.ts.
  exclude: ['./test/probe.spec.ts'],
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'electron',
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
  services: ['electron'],
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },
  tsConfigPath: path.join(__dirname, 'tsconfig.json'),
};
