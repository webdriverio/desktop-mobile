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
  // The execute smoke needs Metro. In CI (RN_BUILD_DIR = the scaffolded RN app the APK was built
  // from) the packed service manages its OWN Metro: the main e2e run owns + tears down its Metro
  // in onComplete before this separate run starts, so there's no shared Metro left to reuse. This
  // also dogfoods managed Metro from the packed tarball. Locally (no RN_BUILD_DIR) it stays a
  // no-op config-composition smoke — run your own Metro.
  ...(process.env.RN_BUILD_DIR
    ? { manageMetro: true, metroProjectRoot: process.env.RN_BUILD_DIR, prebundle: true }
    : { manageMetro: false, metroProjectRoot: process.cwd(), prebundle: false }),
  autoInstallDriver: false,
  doctor: false,
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
        // WDA on CI sims often fails to come up on the first attempt (ECONNREFUSED 8100 / session
        // timeout) and appium's default is only 2 startup retries — bump it, with a generous
        // sim-boot margin. Applies whether WDA is prebuilt (RN_WDA_DD) or built in-session.
        'appium:simulatorStartupTimeout': 240000,
        'appium:wdaStartupRetries': 5,
        'appium:wdaStartupRetryInterval': 20000,
        // Prebuilt WDA launches fast; the in-session build (RN_WDA_DD unset) needs the full
        // xcodebuild-test budget — match e2e/wdio.react-native.conf.ts.
        'appium:wdaLaunchTimeout': process.env.RN_WDA_DD ? 120000 : 720000,
        ...(process.env.RN_WDA_DD
          ? {
              // usePreinstalledWDA simctl-installs + launches the prebuilt Runner.app the workflow
              // leaves under RN_WDA_DD — no xcodebuild at session time (usePrebuiltWDA still shells
              // out to `xcodebuild test`, whose first launch overran undici's ~300s POST /session
              // socket cap → UND_ERR_SOCKET on cold sessions). The reusable strips its embedded
              // XCTest frameworks so it resolves the simulator's local ones.
              'appium:usePreinstalledWDA': true,
              'appium:prebuiltWDAPath': `${process.env.RN_WDA_DD}/Build/Products/Debug-iphonesimulator/WebDriverAgentRunner-Runner.app`,
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
  // iOS session-create ceiling. Prebuilt WDA (RN_WDA_DD) lands quickly within undici's ~300s POST
  // /session socket cap; the in-session build (RN_WDA_DD unset) needs the full WDA-compile budget,
  // so match the e2e conf's 15-min window when it's unset.
  connectionRetryTimeout: platform === 'ios' ? (process.env.RN_WDA_DD ? 420000 : 900000) : 180000,
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
