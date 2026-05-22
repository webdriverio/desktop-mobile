import { existsSync, readFileSync } from 'node:fs';
import path, { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const appPath = path.resolve(__dirname);
const tauriTargetDir = join(appPath, 'src-tauri', 'target', 'debug');
const tauriConfigPath = join(appPath, 'src-tauri', 'tauri.conf.json');

if (!existsSync(tauriConfigPath)) {
  throw new Error(`Tauri config not found: ${tauriConfigPath}`);
}

const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, 'utf-8'));
const productName = (tauriConfig as { productName?: string })?.productName || 'tauri-app-example';

let appBinaryPath: string;
if (process.platform === 'win32') {
  appBinaryPath = join(tauriTargetDir, `${productName}.exe`);
} else if (process.platform === 'linux') {
  appBinaryPath = join(tauriTargetDir, productName.toLowerCase());
} else if (process.platform === 'darwin') {
  appBinaryPath = join(tauriTargetDir, productName);
} else {
  throw new Error(`Unsupported platform: ${process.platform}`);
}

if (!existsSync(appBinaryPath)) {
  throw new Error(`Tauri binary not found: ${appBinaryPath}. Make sure the app is built.`);
}

export const config = {
  runner: 'local',
  specs: ['./test/**/*.spec.ts'],
  exclude: [],
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'tauri',
      'tauri:options': {
        application: appBinaryPath,
      },
      'wdio:tauriServiceOptions': {
        appBinaryPath,
        appArgs: [],
        captureBackendLogs: true,
        captureFrontendLogs: true,
        backendLogLevel: 'debug' as const,
        frontendLogLevel: 'debug' as const,
      },
    },
  ],
  logLevel: (process.env.DEBUG ? 'debug' : 'info') as 'debug' | 'info',
  logLevels: {
    webdriver: 'info' as const,
    '@wdio/tauri-service': 'info' as const,
  },
  bail: 0,
  baseUrl: '',
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  autoXvfb: false,
  outputDir: path.join(__dirname, 'logs'),
  services: [
    [
      '@wdio/tauri-service',
      {
        driverProvider: 'embedded' as const,
        captureBackendLogs: true,
        captureFrontendLogs: true,
      },
    ],
  ],
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },
  tsConfigPath: path.join(__dirname, 'tsconfig.json'),
};
