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
          // The e2e workflow launches the prebuilt WDA once and leaves it resident on :8100; this
          // smoke runs in the same job against that same simulator, so attach to it via
          // webDriverAgentUrl. Appium then never runs its own per-session `simctl launch` of the WDA
          // xctrunner — the command that intermittently wedges CoreSimulator for the full 600s
          // simctl-exec timeout on cold sessions and overran session-create.
          'appium:webDriverAgentUrl': 'http://127.0.0.1:8100',
          'appium:simulatorStartupTimeout': 240000,
          // WDA on CI sims often fails to come up on the first attempt (ECONNREFUSED 8100 /
          // session timeout); appium's default is only 2 startup retries — bump it.
          'appium:wdaStartupRetries': 5,
          'appium:wdaStartupRetryInterval': 20000,
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
  // Generous per-command ceiling for iOS, but kept below the inflated value that fed the cold
  // session-create timeout: with usePreinstalledWDA there's no in-session xcodebuild, so POST
  // /session lands well within undici's ~300s socket cap and doesn't need the WDA-compile budget.
  connectionRetryTimeout: platform === 'ios' ? 420000 : 180000,
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
