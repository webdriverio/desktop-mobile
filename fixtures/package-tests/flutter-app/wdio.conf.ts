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
  // Type-level coverage: assert the published package exports/types the setup-automation
  // options. Values are runtime no-ops so this stays a config-composition smoke test.
  autoInstallDriver: false,
  doctor: false,
};

const capabilities: FlutterCapabilities[] = [
  {
    platformName: platform === 'ios' ? 'iOS' : 'Android',
    'appium:automationName': 'Flutter',
    'appium:deviceName': process.env.FLUTTER_DEVICE_NAME ?? (platform === 'ios' ? 'iPhone 16' : 'emulator-5554'),
    'appium:app': appPath,
    // iOS in CI reuses an already-booted simulator; WDA is prebuilt (FLUTTER_WDA_DD) or built
    // in-session. Unset locally, where Appium builds WDA itself.
    ...(platform === 'ios'
      ? {
          // WDA on CI sims often fails to come up on the first attempt (ECONNREFUSED 8100 / session
          // timeout) and appium's default is only 2 startup retries — bump it, with a generous
          // sim-boot margin. Applies whether WDA is prebuilt or built in-session.
          'appium:simulatorStartupTimeout': 240000,
          'appium:wdaStartupRetries': 5,
          'appium:wdaStartupRetryInterval': 20000,
          // Prebuilt WDA launches fast; the in-session build (FLUTTER_WDA_DD unset) needs the full
          // xcodebuild-test budget — match e2e/wdio.flutter.conf.ts.
          'appium:wdaLaunchTimeout': process.env.FLUTTER_WDA_DD ? 120000 : 720000,
          ...(process.env.FLUTTER_WDA_DD
            ? {
                // usePreinstalledWDA simctl-installs + launches the prebuilt Runner.app the workflow
                // leaves under FLUTTER_WDA_DD — no xcodebuild at session time (usePrebuiltWDA still
                // shells out to `xcodebuild test`, whose first launch overran undici's ~300s POST
                // /session socket cap → UND_ERR_SOCKET on cold sessions). The reusable strips its
                // embedded XCTest frameworks so it resolves the simulator's local ones.
                'appium:usePreinstalledWDA': true,
                'appium:prebuiltWDAPath': `${process.env.FLUTTER_WDA_DD}/Build/Products/Debug-iphonesimulator/WebDriverAgentRunner-Runner.app`,
              }
            : {}),
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
  // iOS session-create ceiling. Prebuilt WDA (FLUTTER_WDA_DD) lands quickly within undici's ~300s
  // POST /session socket cap; the in-session build (FLUTTER_WDA_DD unset) needs the full WDA-compile
  // budget, so match the e2e conf's 15-min window when it's unset.
  connectionRetryTimeout: platform === 'ios' ? (process.env.FLUTTER_WDA_DD ? 420000 : 900000) : 180000,
  // 0 (not 3): a failed iOS session-create otherwise retries the full 13-min timeout 3× — use the
  // spec retry below (fresh session) instead.
  connectionRetryCount: 0,
  // Retry the smoke once on a transient mobile-CI session flake (WDA/boot/attach) — a fresh session
  // with the wdaStartupRetries above usually clears it. (The sticky iOS "unknown to FrontBoard"
  // race needs a leg re-run; see e2e/wdio.flutter.conf.ts.)
  specFileRetries: 1,
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
