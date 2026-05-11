import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Options } from '@wdio/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const config: Options.Testrunner = {
  runner: 'local',
  specs: ['./test/browser.spec.ts'],
  exclude: [],
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'tauri',
      'wdio:tauriServiceOptions': {
        mode: 'browser',
        devServerUrl: 'http://localhost:5173',
      },
    },
  ] as unknown as Options.Testrunner['capabilities'],
  logLevel: 'info',
  outputDir: './logs',
  bail: 0,
  baseUrl: '',
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  autoXvfb: true,
  services: ['tauri'],
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },
  tsConfigPath: `${__dirname}/tsconfig.json`,
};
