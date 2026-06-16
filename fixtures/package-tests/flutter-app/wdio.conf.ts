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
    // iOS in CI reuses an already-booted simulator's prebuilt WebDriverAgent (FLUTTER_WDA_DD) so a
    // session doesn't rebuild WDA. Unset locally, where Appium builds WDA itself.
    ...(platform === 'ios' && process.env.FLUTTER_WDA_DD
      ? {
          'appium:derivedDataPath': process.env.FLUTTER_WDA_DD,
          'appium:usePrebuiltWDA': true,
          'appium:wdaLaunchTimeout': 180000,
          'appium:simulatorStartupTimeout': 240000,
        }
      : {}),
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
  // iOS session-create (XCUITest/WDA attach under appium-flutter-driver) is slower than Android's.
  connectionRetryTimeout: platform === 'ios' ? 420000 : 180000,
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
