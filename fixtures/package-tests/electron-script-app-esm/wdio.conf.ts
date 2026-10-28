import path from 'node:path';
import type { Options } from '@wdio/types';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

export const config: Options.Testrunner = {
  runner: 'local',
  specs: ['./test/**/*.spec.ts'],
  exclude: [],
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'electron',
      'wdio:electronServiceOptions': {
        appEntryPoint: './out/main/index.js',
      },
    },
  ],
  logLevel: 'info',
  outputDir: './logs',
  logLevels: {
    webdriver: 'info',
    '@wdio/utils': 'info',
    '@wdio/electron-service': 'info',
  },
  bail: 0,
  baseUrl: '',
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  // Allows the Linux package test to select wayland for its Weston run (see .github/workflows/_ci-package.reusable.yml)
  displayServer: process.env.DISPLAY_SERVER as Options.Testrunner['displayServer'],
  services: ['electron'],
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },
  tsConfigPath: path.join(__dirname, 'tsconfig.json'),
};
