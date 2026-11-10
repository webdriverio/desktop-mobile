import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { webkitDisplayServer } from './lib/display.js';
import { getLogDirName } from './lib/utils.js';

process.env.DRIVER_PROVIDER = 'embedded';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Note: Embedded provider supports macOS natively — no platform skip needed

const appDir = join(__dirname, '..', 'fixtures', 'e2e-apps', 'dioxus');

function getDioxusBinaryPath(dir: string): string {
  const targetDir = join(dir, 'target', 'debug');
  if (process.platform === 'win32') {
    return join(targetDir, 'wdio-dioxus-e2e-app.exe');
  }
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
    exclude = [
      './test/dioxus/window.spec.ts',
      './test/dioxus/deeplink.spec.ts',
      // The embedded driver refuses screenshots until #741; screenshot.embedded.spec.ts checks that.
      './test/dioxus/visual.spec.ts',
    ];
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
    appArgs?: string[];
    driverProvider: 'embedded';
    embeddedPort?: number;
    captureBackendLogs?: boolean;
    captureFrontendLogs?: boolean;
    backendLogLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
    frontendLogLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
    clearMocks?: boolean;
    resetMocks?: boolean;
    resetMocksPrefix?: string;
    restoreMocks?: boolean;
    restoreMocksPrefix?: string;
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
  // A takes its args from 'dioxus:options' and B from appArgs. Both prefer port 4445, so B gets another
  // free port, which the session reaches only through the launcher.
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
          driverProvider: 'embedded',
          embeddedPort: 4445,
          captureBackendLogs: true,
          captureFrontendLogs: true,
          backendLogLevel: 'info',
          frontendLogLevel: 'info',
        },
      },
    },
    browserB: {
      capabilities: {
        browserName: 'dioxus',
        'wdio:enforceWebDriverClassic': true,
        'dioxus:options': {
          application: appBinaryPath,
        },
        'wdio:dioxusServiceOptions': {
          appBinaryPath,
          appArgs: ['--browser=B'],
          driverProvider: 'embedded',
          embeddedPort: 4445,
          captureBackendLogs: true,
          captureFrontendLogs: true,
          backendLogLevel: 'info',
          frontendLogLevel: 'info',
        },
      },
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
        // Never reaches the app: 'dioxus:options'.args replaces appArgs.
        appArgs: ['--not-passed'],
        driverProvider: 'embedded',
        captureBackendLogs: true,
        captureFrontendLogs: true,
        backendLogLevel: 'info',
        frontendLogLevel: 'info',
        clearMocks: true,
        resetMocks: true,
        resetMocksPrefix: 'mock_options_reset',
        restoreMocks: true,
        restoreMocksPrefix: 'get_command_line_args',
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
  baseUrl: '',
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  ...webkitDisplayServer,
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
    timeout: 60000,
  },
  outputDir: logDir,
};
