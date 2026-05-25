import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getLogDirName } from './lib/utils.js';

process.env.DRIVER_PROVIDER = 'embedded';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Note: Embedded provider supports macOS natively — no platform skip needed

const appDir = join(__dirname, '..', 'fixtures', 'e2e-apps', 'dioxus');

function getDioxusBinaryPath(dir: string): string {
  const targetDir = join(dir, 'target', 'debug');
  if (process.platform === 'win32') return join(targetDir, 'wdio-dioxus-e2e-app.exe');
  return join(targetDir, 'wdio-dioxus-e2e-app');
}

const appBinaryPath = getDioxusBinaryPath(appDir);

const testType = (process.env.TEST_TYPE as string) || 'standard';

let specs: string[] = [];
let exclude: string[] = [];
// Sequential execution required: embedded mode shares a single app instance
let maxInstances = 1;

switch (testType) {
  case 'multiremote':
    specs = ['./test/dioxus/multiremote/*.spec.ts'];
    maxInstances = 1;
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
    maxInstances = 1;
    exclude = ['./test/dioxus/window.spec.ts', './test/dioxus/deeplink.spec.ts'];
    break;
}

type DioxusCapability = {
  browserName?: 'dioxus';
  'wdio:enforceWebDriverClassic'?: boolean;
  // DIAGNOSTIC (revert when macOS-ARM polling-loop hang is rooted out):
  // shrinks the embedded driver's per-session script_timeout so a hung
  // executeScript fails in 5s instead of the 30s default.
  timeouts?: { script?: number; pageLoad?: number; implicit?: number };
  'dioxus:options': {
    application: string;
    args?: string[];
  };
  'wdio:dioxusServiceOptions': {
    appBinaryPath: string;
    appArgs: string[];
    driverProvider: 'embedded';
    embeddedPort?: number;
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
        timeouts: { script: 5000 },
        'dioxus:options': {
          application: appBinaryPath,
          args: ['--browser=A'],
        },
        'wdio:dioxusServiceOptions': {
          appBinaryPath,
          appArgs: ['--browser=A'],
          driverProvider: 'embedded',
          embeddedPort: 4445,
          captureBackendLogs: true,
          captureFrontendLogs: true,
          backendLogLevel: 'info',
          frontendLogLevel: 'info',
        },
      },
      hostname: '127.0.0.1',
      port: 4445,
    },
    browserB: {
      capabilities: {
        browserName: 'dioxus',
        'wdio:enforceWebDriverClassic': true,
        timeouts: { script: 5000 },
        'dioxus:options': {
          application: appBinaryPath,
          args: ['--browser=B'],
        },
        'wdio:dioxusServiceOptions': {
          appBinaryPath,
          appArgs: ['--browser=B'],
          driverProvider: 'embedded',
          embeddedPort: 4446,
          captureBackendLogs: true,
          captureFrontendLogs: true,
          backendLogLevel: 'info',
          frontendLogLevel: 'info',
        },
      },
      hostname: '127.0.0.1',
      port: 4446,
    },
  };
} else {
  capabilities = [
    {
      browserName: 'dioxus',
      'wdio:enforceWebDriverClassic': true,
      timeouts: { script: 5000 },
      'dioxus:options': {
        application: appBinaryPath,
        args: ['foo', 'bar=baz'],
      },
      'wdio:dioxusServiceOptions': {
        appBinaryPath,
        appArgs: ['foo', 'bar=baz'],
        driverProvider: 'embedded',
        captureBackendLogs: true,
        captureFrontendLogs: true,
        backendLogLevel: 'info',
        frontendLogLevel: 'info',
      },
    },
  ];
}

const logDirName = getLogDirName(testType, 'dioxus', 'embedded');
const logDir = join(__dirname, 'logs', logDirName);

export const config = {
  runner: 'local',
  specs,
  exclude,
  maxInstances,
  capabilities,
  logLevel: 'info',
  // DIAGNOSTIC (root-causing macOS-ARM polling-loop death — revert when fixed):
  //   bail:1 → stop after first spec failure so we don't wait 60+ min
  //     watching the cascade.
  //   connectionRetryCount:0 → disable WDIO's 3-retry on failed commands.
  //     A hung executeScript no longer eats 30s × 3; fails in one 30s window.
  //   mochaOpts.timeout:30000 → match the script_timeout window so the
  //     mocha test doesn't wait an extra 90s after the script gives up.
  bail: 1,
  baseUrl: '',
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 0,
  autoXvfb: false,
  services: [
    [
      '@wdio/dioxus-service',
      {
        driverProvider: 'embedded',
      },
    ],
    '@wdio/visual-service',
  ],
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 30000,
  },
  outputDir: logDir,
};
