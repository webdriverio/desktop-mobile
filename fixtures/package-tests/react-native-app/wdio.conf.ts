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
        // CI reuses an already-booted simulator + prebuilt WebDriverAgent: pin the exact sim
        // (RN_IOS_UDID) and reuse the WDA build (RN_WDA_DD) so a session neither re-boots a sim nor
        // rebuilds WDA. Both are unset locally, where Appium resolves by name and builds WDA itself.
        ...(process.env.RN_IOS_UDID ? { 'appium:udid': process.env.RN_IOS_UDID } : {}),
        ...(process.env.RN_WDA_DD
          ? {
              'appium:derivedDataPath': process.env.RN_WDA_DD,
              'appium:usePrebuiltWDA': true,
              // Tight per-attempt ceiling (prebuilt WDA just launches) so the startup retries fit
              // inside connectionRetryTimeout below.
              'appium:wdaLaunchTimeout': 120000,
              // Safety margin for appium's sim-boot monitor on a cold/slow runner (matches the
              // Flutter fixture + the e2e confs).
              'appium:simulatorStartupTimeout': 240000,
              // WDA on CI sims often fails to come up on the first attempt (ECONNREFUSED 8100 /
              // session timeout); appium's default is only 2 startup retries — bump it.
              'appium:wdaStartupRetries': 5,
              'appium:wdaStartupRetryInterval': 20000,
            }
          : {}),
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
  // iOS must exceed the WDA startup-retry budget (wdaStartupRetries × (wdaLaunchTimeout +
  // interval) ≈ 5×140s) so WDIO doesn't abort the cold session-create mid-retry.
  connectionRetryTimeout: platform === 'ios' ? 780000 : 180000,
  // 0 (not 3): a failed iOS session-create otherwise retries the full 13-min timeout 3× — use the
  // spec retry below (fresh session) instead.
  connectionRetryCount: 0,
  // Retry the smoke once on a transient mobile-CI session flake (WDA/boot/attach) — a fresh session
  // with the wdaStartupRetries above usually clears it.
  specFileRetries: 1,
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
