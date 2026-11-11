import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const config: WebdriverIO.Config = {
  runner: 'local',
  specs: ['./test-browser/browser.spec.ts'],
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
  ],
  logLevel: 'info',
  outputDir: './logs',
  bail: 0,
  baseUrl: '',
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  services: ['tauri'],
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },
  tsConfigPath: `${__dirname}/tsconfig.json`,
};
