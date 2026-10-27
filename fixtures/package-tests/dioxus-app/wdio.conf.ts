import { existsSync } from 'node:fs';
import path, { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const appPath = path.resolve(__dirname);
// The Cargo workspace's target/ sits next to src-dioxus/. dx names the macOS bundle
// with the bin name in Pascal case.
const appName = 'dioxus-package-test-app';
const bundleRoot = join(appPath, 'target', 'dx', appName, 'debug');
const appBinaryByPlatform: Record<string, string> = {
  linux: join(bundleRoot, 'linux', 'app', appName),
  darwin: join(bundleRoot, 'macos', 'DioxusPackageTestApp.app', 'Contents', 'MacOS', appName),
  win32: join(bundleRoot, 'windows', 'app', `${appName}.exe`),
};
const appBinaryPath = appBinaryByPlatform[process.platform];

if (!appBinaryPath) {
  throw new Error(`No dx output path for platform ${process.platform}.`);
}

if (!existsSync(appBinaryPath)) {
  throw new Error(
    `Dioxus binary not found: ${appBinaryPath}. Run 'pnpm build' first; scripts/install-dx.sh installs the dx it needs.`,
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
  // Normally unset, so WebdriverIO picks the display server itself. The Ubuntu Docker
  // test sets it to wayland for its Weston run (see container-test.sh).
  displayServer: process.env.DISPLAY_SERVER,
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
