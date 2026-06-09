import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ReactNativeCapabilities, ReactNativeServiceOptions } from '@wdio/native-types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Set RN_APP_PATH to your built APK (Android) or .app bundle (iOS).
// Without it the config throws a descriptive error on startup.
const appPath = process.env.RN_APP_PATH;
if (!appPath) {
  throw new Error(
    'RN_APP_PATH is not set. Point it at a built React Native APK or .app:\n' +
      '  Android: android/app/build/outputs/apk/debug/app-debug.apk\n' +
      '  iOS:     ios/build/Build/Products/Debug-iphonesimulator/<App>.app',
  );
}

// Select platform from RN_PLATFORM (defaults to Android).
const rawPlatform = (process.env.RN_PLATFORM ?? 'android').toLowerCase();
if (rawPlatform !== 'android' && rawPlatform !== 'ios') {
  throw new Error(`RN_PLATFORM must be 'android' or 'ios', got: ${rawPlatform}`);
}
const platform = rawPlatform as 'android' | 'ios';

const rnServiceOptions: ReactNativeServiceOptions = {
  captureBackendLogs: true,
  captureFrontendLogs: true,
};

const capabilities: ReactNativeCapabilities[] = [
  platform === 'ios'
    ? {
        platformName: 'iOS',
        'appium:automationName': 'XCUITest',
        'appium:deviceName': process.env.RN_DEVICE_NAME ?? 'iPhone 16',
        'appium:platformVersion': process.env.RN_PLATFORM_VERSION ?? '18.0',
        'appium:app': appPath,
        'appium:noReset': true,
        'wdio:reactNativeServiceOptions': rnServiceOptions,
      }
    : {
        platformName: 'Android',
        'appium:automationName': 'UiAutomator2',
        'appium:deviceName': process.env.RN_DEVICE_NAME ?? 'emulator-5554',
        'appium:app': appPath,
        'appium:noReset': true,
        'wdio:reactNativeServiceOptions': rnServiceOptions,
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
      'react-native',
      {
        ...rnServiceOptions,
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
