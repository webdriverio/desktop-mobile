import { existsSync } from 'node:fs';
import path, { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const appPath = path.resolve(__dirname);
const targetDir = join(appPath, 'src-dioxus', 'target', 'debug');
const binaryName = process.platform === 'win32' ? 'dioxus-package-test-app.exe' : 'dioxus-package-test-app';
const appBinaryPath = join(targetDir, binaryName);

if (!existsSync(appBinaryPath)) {
  throw new Error(
    `Dioxus binary not found: ${appBinaryPath}. Run 'cargo build --manifest-path src-dioxus/Cargo.toml' first.`,
  );
}

type DioxusCapability = {
  browserName?: 'dioxus';
  'wdio:enforceWebDriverClassic'?: boolean;
  'dioxus:options': { application: string; args?: string[] };
  'wdio:dioxusServiceOptions': {
    appBinaryPath: string;
    appArgs: string[];
    driverProvider: 'embedded';
    captureBackendLogs?: boolean;
    captureFrontendLogs?: boolean;
    backendLogLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
    frontendLogLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  };
};

const capabilities: DioxusCapability[] = [
  {
    browserName: 'dioxus',
    'wdio:enforceWebDriverClassic': true,
    'dioxus:options': { application: appBinaryPath },
    'wdio:dioxusServiceOptions': {
      appBinaryPath,
      appArgs: [],
      driverProvider: 'embedded',
      captureBackendLogs: true,
      captureFrontendLogs: true,
      backendLogLevel: 'debug',
      frontendLogLevel: 'debug',
    },
  },
];

export const config = {
  runner: 'local',
  specs: ['./test/**/*.spec.ts'],
  exclude: [],
  maxInstances: 1,
  capabilities,
  logLevel: 'info',
  bail: 0,
  baseUrl: '',
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  autoXvfb: false,
  outputDir: path.join(__dirname, 'logs'),
  services: [
    [
      '@wdio/dioxus-service',
      {
        driverProvider: 'embedded',
      },
    ],
  ],
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 120000,
  },
  tsConfigPath: path.join(__dirname, 'tsconfig.json'),
};
