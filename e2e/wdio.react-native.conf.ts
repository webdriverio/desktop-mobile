import { appendFileSync, existsSync, globSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ReactNativeServiceOptions } from '@wdio/native-types';

import { getLogDirName } from './lib/utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const appDir = join(__dirname, '..', 'fixtures', 'e2e-apps', 'react-native');

// Target platform for this run (Android by default; the iOS CI leg sets RN_PLATFORM=ios).
const platform = (process.env.RN_PLATFORM ?? 'android').toLowerCase() as 'android' | 'ios';

const newest = (paths: string[]): string => {
  if (paths.length === 0) {
    throw new Error('newest: called with empty array');
  }
  return paths.map((p) => ({ p, m: statSync(p).mtimeMs })).sort((a, b) => b.m - a.m)[0].p;
};

/**
 * Locate the built app for `appium:app`.
 *
 * React Native is Appium-driven (unlike the CDP/Wry desktop services): WDIO opens the
 * Appium session from `appium:app`, and the service attaches to the app's Hermes realm
 * over Metro's inspector for execute/mock. CI sets `RN_APP_PATH` to the exact artifact
 * built by the job; locally we glob the standard build-output path. The native
 * `android/`/`ios/` projects are generated (see the fixture README), so these paths only
 * exist after the platform build (or the CI build step) has run.
 */
function resolveAppPath(dir: string): string {
  const override = process.env.RN_APP_PATH;
  if (override) {
    return override;
  }
  if (platform === 'ios') {
    // iOS Simulator .app from a debug xcodebuild.
    const apps = globSync(join(dir, 'ios', '**', 'Build', 'Products', 'Debug-iphonesimulator', '*.app'));
    if (apps.length > 0) {
      return newest(apps);
    }
    throw new Error(
      `No iOS .app found under ${join(dir, 'ios')}. Build the fixture for the simulator or set RN_APP_PATH.`,
    );
  }
  const standard = join(dir, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  if (existsSync(standard)) {
    return standard;
  }
  // Fallback: newest matching debug APK anywhere under the android build tree.
  // NOTE: fs.globSync requires Node >= 22 (the repo targets Node 24 LTS); if the minimum Node
  // version is ever lowered, swap this for the `glob` package or a manual recursive walk.
  const candidates = globSync(join(dir, 'android', '**', '*.apk'));
  if (candidates.length > 0) {
    return newest(candidates);
  }
  throw new Error(
    `No Android APK found under ${join(dir, 'android')}. ` +
      'Build the fixture first (pnpm --filter react-native-e2e-app build:android) or set RN_APP_PATH.',
  );
}

const appPath = resolveAppPath(appDir);
if (!existsSync(appPath)) {
  throw new Error(`React Native app artifact does not exist: ${appPath}. Make sure the app is built.`);
}

const testType = (process.env.TEST_TYPE as string) || 'standard';
const metroPort = Number(process.env.RN_METRO_PORT ?? 8081);

let specs: string[] = [];
let exclude: string[] = [];

switch (testType) {
  case 'deeplink':
    specs = ['./test/react-native/deeplink.spec.ts'];
    break;
  default:
    specs = ['./test/react-native/*.spec.ts'];
    exclude = ['./test/react-native/deeplink.spec.ts'];
    break;
}

const isIos = platform === 'ios';

const reactNativeServiceOptions: ReactNativeServiceOptions = {
  platform: isIos ? 'iOS' : 'Android',
  metroPort,
  // Forward the app's JS console + native (logcat/syslog) logs into the WDIO log.
  captureBackendLogs: true,
};

type ReactNativeCapability = {
  platformName: 'Android' | 'iOS';
  'appium:automationName': 'UiAutomator2' | 'XCUITest';
  'appium:app': string;
  'appium:newCommandTimeout': number;
  'appium:deviceName'?: string;
  'appium:wdaLaunchTimeout'?: number;
  'appium:simulatorStartupTimeout'?: number;
  'wdio:reactNativeServiceOptions': ReactNativeServiceOptions;
};

const capabilities: ReactNativeCapability[] = [
  {
    platformName: isIos ? 'iOS' : 'Android',
    'appium:automationName': isIos ? 'XCUITest' : 'UiAutomator2',
    'appium:app': appPath,
    'appium:newCommandTimeout': 240,
    // iOS needs a target simulator; CI sets RN_IOS_DEVICE (e.g. 'iPhone 16'). wdaLaunchTimeout
    // is generous because appium-xcuitest compiles WebDriverAgent on the first session of a cold
    // runner (minutes); without it the session create aborts before WDA is ready.
    ...(isIos
      ? {
          'appium:deviceName': process.env.RN_IOS_DEVICE ?? 'iPhone 16',
          'appium:wdaLaunchTimeout': 240000,
          // The workflow pre-boots the sim, but appium re-monitors boot on session create and the
          // default 120s ceiling has timed out on a cold/slow runner ("failed to finish booting
          // after 122s"). Give it headroom.
          'appium:simulatorStartupTimeout': 240000,
        }
      : {}),
    'wdio:reactNativeServiceOptions': reactNativeServiceOptions,
  },
];

const logDirName = getLogDirName(testType, 'react-native');
const logDir = join(__dirname, 'logs', logDirName);

export const config = {
  runner: 'local',
  specs,
  exclude,
  // One emulator per CI job; multiremote/multi-device is exercised by unit tests, not here.
  maxInstances: 1,
  capabilities,
  logLevel: 'info',
  bail: 0,
  // TEMPORARY (while stabilising #353): retry counts dialled down so a failing iOS leg surfaces
  // in ONE attempt (~the WDA window) instead of multiplying the 10-min session timeout — fast
  // iteration. RESTORE before merge: specFileRetries 1, connectionRetryCount 3, mochaOpts.retries 1
  // (they absorb emulator boot / first-attach flake). The iOS connectionRetryTimeout stays high —
  // WDA needs it.
  specFileRetries: 0,
  specFileRetriesDeferred: false,
  baseUrl: '',
  waitforTimeout: 15000,
  // iOS: the first `POST /session` blocks while appium-xcuitest builds WebDriverAgent (several
  // minutes on a cold macOS runner). The default 3-min request timeout aborts mid-build, so give
  // iOS a 10-min ceiling; Android stays tight. (It's a max, not a delay — fast commands return fast.)
  connectionRetryTimeout: isIos ? 600000 : 180000,
  // 0 while stabilising: a failed iOS session-create otherwise retries the full 10-min timeout,
  // doubling the runtime. RESTORE to 3 before merge.
  connectionRetryCount: 0,
  // @wdio/appium-service boots the Appium 2 server; @wdio/react-native-service prepares
  // capabilities (automationName/app) and attaches the Hermes bridge for execute/mock.
  services: ['appium', 'react-native'],
  port: 4723,
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 120000,
    retries: 0,
  },
  outputDir: logDir,
  // On a test failure, write the Appium page source to a .log file in the logs dir (which
  // is uploaded as an artifact, unlike hook stdout) so a NoSuchElement is diagnosable from
  // the actual UI hierarchy rather than re-guessing.
  afterTest: async (test: { title?: string }, _ctx: unknown, result: { error?: unknown }) => {
    if (!result.error) {
      return;
    }
    const out = join(logDir, 'page-source.log');
    try {
      const { browser } = await import('@wdio/globals');
      const source = await browser.getPageSource();
      mkdirSync(logDir, { recursive: true });
      appendFileSync(out, `\n===== ${test.title ?? 'test'} =====\n${source}\n`);
    } catch (err) {
      try {
        mkdirSync(logDir, { recursive: true });
        appendFileSync(out, `\ncapture failed for '${test.title ?? 'test'}': ${(err as Error).message}\n`);
      } catch {
        // best-effort diagnostic; never let it mask the real test failure
      }
    }
  },
};
