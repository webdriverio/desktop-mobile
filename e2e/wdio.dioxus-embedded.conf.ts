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
    // DIAGNOSTIC: api.spec.ts moved to last. On main + this branch's CI,
    // api.spec.ts is the only spec that passes on macOS-ARM (it runs first
    // alphabetically). If the failure is positional (every spec after the
    // first hangs) api.spec.ts will now also fail and application.spec.ts
    // (now first) will pass. If api.spec.ts still passes here, it's
    // spec-content-specific and we move to option 1 (dep bisection).
    // Revert to glob `'./test/dioxus/*.spec.ts'` once diagnosed.
    specs = [
      './test/dioxus/application.spec.ts',
      './test/dioxus/execute-advanced.spec.ts',
      './test/dioxus/execute-data-types.spec.ts',
      './test/dioxus/logging.embedded.spec.ts',
      './test/dioxus/logging.spec.ts',
      './test/dioxus/mocking.spec.ts',
      './test/dioxus/visual.spec.ts',
      './test/dioxus/api.spec.ts',
    ];
    maxInstances = 1;
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
        driverProvider: 'embedded',
      },
    ],
    '@wdio/visual-service',
  ],
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 120000,
  },
  outputDir: logDir,
};
