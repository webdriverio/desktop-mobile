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
  // Forward both channels into the WDIO log: backend = native logcat/syslog,
  // frontend = the app's JS/Metro console. The logging spec asserts frontend capture.
  captureBackendLogs: true,
  captureFrontendLogs: true,
};

type ReactNativeCapability = {
  platformName: 'Android' | 'iOS';
  'appium:automationName': 'UiAutomator2' | 'XCUITest';
  'appium:app': string;
  'appium:newCommandTimeout': number;
  'appium:deviceName'?: string;
  'appium:udid'?: string;
  'appium:wdaLaunchTimeout'?: number;
  'appium:simulatorStartupTimeout'?: number;
  'appium:usePreinstalledWDA'?: boolean;
  'appium:prebuiltWDAPath'?: string;
  'appium:wdaStartupRetries'?: number;
  'appium:wdaStartupRetryInterval'?: number;
  'appium:isHeadless'?: boolean;
  'wdio:reactNativeServiceOptions': ReactNativeServiceOptions;
};

const capabilities: ReactNativeCapability[] = [
  {
    platformName: isIos ? 'iOS' : 'Android',
    'appium:automationName': isIos ? 'XCUITest' : 'UiAutomator2',
    'appium:app': appPath,
    'appium:newCommandTimeout': 240,
    // iOS needs a target simulator; CI sets RN_IOS_DEVICE (e.g. 'iPhone 16').
    ...(isIos
      ? {
          'appium:deviceName': process.env.RN_IOS_DEVICE ?? 'iPhone 16',
          // Pin the exact simulator the workflow already booted. Without a udid, appium resolves
          // the deviceName independently and — when the runner image carries duplicate device names
          // across runtimes — can monitor/boot a *different* instance than CI pre-booted, surfacing
          // as "failed to finish booting" even though our `bootstatus -b` step passed (#359). CI
          // exports RN_IOS_UDID from the boot step; omitted locally (appium resolves by name).
          ...(process.env.RN_IOS_UDID ? { 'appium:udid': process.env.RN_IOS_UDID } : {}),
          // wdaLaunchTimeout is a ceiling, not a delay. CI pre-builds WDA into RN_WDA_DD (reused
          // via usePreinstalledWDA below — simctl install/launch) so the first session just launches
          // it — fast, a tight ceiling is fine. Without a prebuilt WDA (local) appium compiles it on
          // the first session (several minutes), so the wait must stay generous. connectionRetryTimeout
          // below tracks this.
          // Prebuilt WDA just launches (no compile), so a tight per-attempt ceiling lets several
          // startup retries fit inside connectionRetryTimeout below.
          'appium:wdaLaunchTimeout': process.env.RN_WDA_DD ? 120000 : 720000,
          // CI boots the sim headless (simctl). Without isHeadless, XCUITest restarts it on
          // session-create "with the Simulator window visible" — a ~225s GUI re-boot on a
          // display-less runner that raced the 240s ceiling below and was the proven root cause
          // of the #359 first-session flake (the appium debug log showed "booted in 230.541s").
          // Headless skips that restart and reuses the already-booted sim. CI-only: a local run
          // still wants the visible window, and appium boots its own sim there.
          ...(process.env.CI ? { 'appium:isHeadless': true } : {}),
          // Safety margin for appium's boot monitor on a cold/slow runner; with isHeadless above
          // the redundant restart is gone, so this ceiling should no longer be approached in CI.
          'appium:simulatorStartupTimeout': 240000,
          // WDA on GitHub-Actions sims often fails to come up on the first attempt (ECONNREFUSED
          // 8100 / session-create timeout); appium's default is only 2 startup retries — bump it.
          'appium:wdaStartupRetries': 5,
          'appium:wdaStartupRetryInterval': 20000,
          // CI pre-builds WDA into RN_WDA_DD; simctl-install + launch it via usePreinstalledWDA (no
          // per-session xcodebuild → short POST /session → no UND_ERR_SOCKET). usePrebuiltWDA still
          // shells out to `xcodebuild test`, which overran undici's ~300s socket cap. The reusable
          // strips the runner's embedded XCTest frameworks. Omitted locally so appium builds WDA.
          ...(process.env.RN_WDA_DD
            ? {
                'appium:usePreinstalledWDA': true,
                'appium:prebuiltWDAPath': `${process.env.RN_WDA_DD}/Build/Products/Debug-iphonesimulator/WebDriverAgentRunner-Runner.app`,
              }
            : {}),
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
  // Two spec retries to absorb transient mobile-CI flake (emulator/simulator boot, first-session
  // attach, WDA-not-up). Each retry is a fresh session, which together with the in-session
  // wdaStartupRetries above clears the WDA ECONNREFUSED / session-create flakes. NOTE: iOS also has
  // an intermittent appium-sim "unknown to FrontBoard" flake that in-run retries CAN'T clear (same
  // sim) — re-run the leg to clear it. Tracked in #359; neither noReset nor fullReset fixed it.
  specFileRetries: 2,
  specFileRetriesDeferred: false,
  baseUrl: '',
  waitforTimeout: 15000,
  // iOS: generous per-command ceiling, but kept below the inflated value that fed cold
  // session-create — with usePreinstalledWDA there's no in-session xcodebuild, so POST /session
  // lands inside undici's ~300s socket cap and doesn't need the WDA-compile budget. The sticky
  // "unknown to FrontBoard" (#359) still needs a leg re-run. Without a prebuilt WDA (local) it
  // stays generous; Android tight.
  connectionRetryTimeout: isIos ? (process.env.RN_WDA_DD ? 420000 : 900000) : 180000,
  // 0: a failed iOS session-create otherwise retries the full timeout, ballooning runtime; the
  // deferred specFileRetry above is the recovery path instead.
  connectionRetryCount: 0,
  // @wdio/appium-service boots the Appium server; @wdio/react-native-service prepares
  // capabilities (automationName/app) and attaches the Hermes bridge for execute/mock.
  // logPath writes the full appium server output to <logDir>/wdio-appium.log (uploaded as a CI
  // artifact via the e2e/logs/**/*.log glob); --log-level debug surfaces the XCUITest driver's
  // sim-boot/WDA/FrontBoard trace, which is the only place the #359 session-create flake is
  // diagnosable (the failing session has no app/page-source to capture).
  services: [['appium', { logPath: logDir, args: { logLevel: 'debug' } }], 'react-native'],
  port: 4723,
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 120000,
    retries: 0,
  },
  outputDir: logDir,
  // App-ready gate: wait for the fixture to be interactive before any spec runs. On Android
  // New-Arch (Fabric) the view tree registers later than Paper, and Metro's first bundle adds
  // latency, so the earliest specs would otherwise race an empty tree. Also confirms the app +
  // Hermes realm are live before the execute/mock specs.
  before: async () => {
    const { browser } = await import('@wdio/globals');
    await browser.$('~counter').waitForDisplayed({ timeout: 90000 });
  },
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
