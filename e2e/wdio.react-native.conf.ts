import { appendFileSync, existsSync, globSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ReactNativeServiceOptions } from '@wdio/native-types';

import { getLogDirName } from './lib/utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const appDir = join(__dirname, '..', 'fixtures', 'e2e-apps', 'react-native');

/**
 * Locate the built Android debug APK.
 *
 * React Native is Appium-driven (unlike the CDP/Wry desktop services): WDIO opens the
 * Appium session from `appium:app`, and the service attaches to the app's Hermes realm
 * over Metro's inspector for execute/mock. CI sets `RN_APP_PATH` to the exact APK built
 * by the build job; locally we glob the standard Gradle output path.
 *
 * The native `android/` project is generated (see fixtures/e2e-apps/react-native/README),
 * so this path only exists after `pnpm build:android` (or the CI build step) has run.
 */
function resolveAndroidApk(dir: string): string {
  const override = process.env.RN_APP_PATH;
  if (override) {
    return override;
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
    return candidates.map((p) => ({ p, m: statSync(p).mtimeMs })).sort((a, b) => b.m - a.m)[0].p;
  }
  throw new Error(
    `No Android APK found under ${join(dir, 'android')}. ` +
      'Build the fixture first (pnpm --filter react-native-e2e-app build:android) or set RN_APP_PATH.',
  );
}

const appPath = resolveAndroidApk(appDir);
if (!existsSync(appPath)) {
  throw new Error(`React Native APK does not exist: ${appPath}. Make sure the app is built.`);
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

const reactNativeServiceOptions: ReactNativeServiceOptions = {
  platform: 'Android',
  metroPort,
  // Forward the app's JS console + logcat into the WDIO log for the logging spec.
  captureBackendLogs: true,
};

type ReactNativeCapability = {
  platformName: 'Android';
  'appium:automationName': 'UiAutomator2';
  'appium:app': string;
  'appium:newCommandTimeout': number;
  'wdio:reactNativeServiceOptions': ReactNativeServiceOptions;
};

const capabilities: ReactNativeCapability[] = [
  {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:app': appPath,
    'appium:newCommandTimeout': 240,
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
  // Emulator boot + app install is slow and occasionally flaky on first attach; a
  // spec-file retry re-launches the app cleanly.
  specFileRetries: 1,
  specFileRetriesDeferred: false,
  baseUrl: '',
  waitforTimeout: 15000,
  connectionRetryTimeout: 180000,
  connectionRetryCount: 3,
  // @wdio/appium-service boots the Appium 2 server; @wdio/react-native-service prepares
  // capabilities (automationName/app) and attaches the Hermes bridge for execute/mock.
  services: ['appium', 'react-native'],
  port: 4723,
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 120000,
    retries: 1,
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
