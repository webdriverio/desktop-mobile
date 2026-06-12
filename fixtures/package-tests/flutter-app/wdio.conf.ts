import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FlutterCapabilities, FlutterServiceOptions } from '@wdio/native-types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Set FLUTTER_APP_PATH to your built debug APK (Android) or .app bundle (iOS).
// Without it the config throws a descriptive error on startup.
const appPath = process.env.FLUTTER_APP_PATH;
if (!appPath) {
  throw new Error(
    'FLUTTER_APP_PATH is not set. Point it at a built Flutter debug app:\n' +
      '  Android: build/app/outputs/flutter-apk/app-debug.apk\n' +
      '  iOS:     build/ios/iphonesimulator/Runner.app',
  );
}

// Select platform from FLUTTER_PLATFORM (defaults to Android).
const rawPlatform = (process.env.FLUTTER_PLATFORM ?? 'android').toLowerCase();
if (rawPlatform !== 'android' && rawPlatform !== 'ios') {
  throw new Error(`FLUTTER_PLATFORM must be 'android' or 'ios', got: ${rawPlatform}`);
}
const platform = rawPlatform as 'android' | 'ios';

const flutterServiceOptions: FlutterServiceOptions = {
  captureBackendLogs: true,
};

const capabilities: FlutterCapabilities[] = [
  {
    platformName: platform === 'ios' ? 'iOS' : 'Android',
    'appium:automationName': 'Flutter',
    'appium:deviceName': process.env.FLUTTER_DEVICE_NAME ?? (platform === 'ios' ? 'iPhone 16' : 'emulator-5554'),
    'appium:app': appPath,
    'wdio:flutterServiceOptions': flutterServiceOptions,
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
  waitforTimeout: 30000,
  connectionRetryTimeout: 180000,
  connectionRetryCount: 3,
  outputDir: join(__dirname, 'logs'),
  services: [
    'appium',
    [
      'flutter',
      {
        ...flutterServiceOptions,
      },
    ],
  ],
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },
  tsConfigPath: join(__dirname, 'tsconfig.json'),
};
