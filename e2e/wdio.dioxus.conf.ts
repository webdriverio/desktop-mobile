import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getLogDirName } from './lib/utils.js';

// Exit 78 on darwin — 'external' provider not supported on macOS
if (process.platform === 'darwin') {
  console.log('Skipping Dioxus external-provider tests on macOS — use embedded provider');
  process.exit(78);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const appDir = join(__dirname, '..', 'fixtures', 'e2e-apps', 'dioxus');

function getDioxusBinaryPath(dir: string): string {
  const targetDir = join(dir, 'target', 'debug');
  if (process.platform === 'win32') return join(targetDir, 'wdio-dioxus-e2e-app.exe');
  return join(targetDir, 'wdio-dioxus-e2e-app');
}

const appBinaryPath = getDioxusBinaryPath(appDir);

const testType = (process.env.TEST_TYPE as string) || 'standard';
const driverProvider = (process.env.DRIVER_PROVIDER as string) || 'external';

let specs: string[] = [];
let exclude: string[] = [];
let maxInstances = 5;

switch (testType) {
  case 'multiremote':
    specs = ['./test/dioxus/multiremote/*.spec.ts'];
    maxInstances = 1;
    break;
  case 'standalone':
    specs = ['./test/dioxus/standalone/*.spec.ts'];
    break;
  case 'window':
    specs = ['./test/dioxus/window.spec.ts'];
    break;
  case 'deeplink':
    specs = ['./test/dioxus/deeplink.spec.ts'];
    maxInstances = 1;
    break;
  default:
    specs = ['./test/dioxus/*.spec.ts'];
    exclude = ['./test/dioxus/window.spec.ts', './test/dioxus/deeplink.spec.ts'];
    break;
}

type DioxusCapability = {
  browserName?: 'dioxus';
  'wdio:enforceWebDriverClassic'?: boolean;
  'dioxus:options': {
    application: string;
    args?: string[];
  };
  'wdio:dioxusServiceOptions': {
    appBinaryPath: string;
    appArgs: string[];
    driverProvider?: string;
    captureBackendLogs?: boolean;
    captureFrontendLogs?: boolean;
    backendLogLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
    frontendLogLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  };
};

type InstanceConfig = {
  capabilities: DioxusCapability;
  hostname?: string;
  port?: number;
};

type MultiremoteCapabilities = {
  browserA: InstanceConfig;
  browserB: InstanceConfig;
};

type StandardCapabilities = DioxusCapability[];

let capabilities: MultiremoteCapabilities | StandardCapabilities;

if (testType === 'multiremote') {
  capabilities = {
    browserA: {
      capabilities: {
        browserName: 'dioxus',
        'wdio:enforceWebDriverClassic': true,
        'dioxus:options': {
          application: appBinaryPath,
          args: ['--browser=A'],
        },
        'wdio:dioxusServiceOptions': {
          appBinaryPath,
          appArgs: ['--browser=A'],
          driverProvider,
          captureBackendLogs: true,
          captureFrontendLogs: true,
          backendLogLevel: 'info',
          frontendLogLevel: 'info',
        },
      },
      hostname: '127.0.0.1',
      port: 0,
    },
    browserB: {
      capabilities: {
        browserName: 'dioxus',
        'wdio:enforceWebDriverClassic': true,
        'dioxus:options': {
          application: appBinaryPath,
          args: ['--browser=B'],
        },
        'wdio:dioxusServiceOptions': {
          appBinaryPath,
          appArgs: ['--browser=B'],
          driverProvider,
          captureBackendLogs: true,
          captureFrontendLogs: true,
          backendLogLevel: 'info',
          frontendLogLevel: 'info',
        },
      },
      hostname: '127.0.0.1',
      port: 0,
    },
  };
} else {
  capabilities = [
    {
      browserName: 'dioxus',
      'wdio:enforceWebDriverClassic': true,
      'dioxus:options': {
        application: appBinaryPath,
        args: ['foo', 'bar=baz'],
      },
      'wdio:dioxusServiceOptions': {
        appBinaryPath,
        appArgs: ['foo', 'bar=baz'],
        driverProvider,
        captureBackendLogs: true,
        captureFrontendLogs: true,
        backendLogLevel: 'info',
        frontendLogLevel: 'info',
      },
    },
  ];
}

const logDirName = getLogDirName(testType, 'dioxus', 'official');
const logDir = join(__dirname, 'logs', logDirName);

export const config = {
  runner: 'local',
  specs,
  exclude,
  maxInstances,
  capabilities,
  logLevel: 'info',
  bail: 0,
  baseUrl: '',
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  autoXvfb: false,
  services: [
    [
      '@wdio/dioxus-service',
      {
        driverProvider,
      },
    ],
  ],
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
    retries: 2,
  },
  outputDir: logDir,
};
