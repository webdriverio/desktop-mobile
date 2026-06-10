import { appendFileSync, existsSync, globSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FlutterServiceOptions } from '@wdio/native-types';

import { getLogDirName } from './lib/utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const appDir = join(__dirname, '..', 'fixtures', 'e2e-apps', 'flutter');

// Target platform (Android by default; the iOS leg sets FLUTTER_PLATFORM=ios — PR5).
const platform = (process.env.FLUTTER_PLATFORM ?? 'android').toLowerCase() as 'android' | 'ios';
const isIos = platform === 'ios';

const newest = (paths: string[]): string => {
  if (paths.length === 0) {
    throw new Error('newest: called with empty array');
  }
  return paths.map((p) => ({ p, m: statSync(p).mtimeMs })).sort((a, b) => b.m - a.m)[0].p;
};

/**
 * Locate the built fixture for `appium:app`. CI sets `FLUTTER_APP_PATH` to the exact artifact;
 * locally we glob Flutter's standard debug-build output. The native `android/`/`ios/` projects
 * are generated (`flutter create`), so these paths only exist after the build step has run.
 */
function resolveAppPath(dir: string): string {
  const override = process.env.FLUTTER_APP_PATH;
  if (override) {
    return override;
  }
  if (isIos) {
    const apps = globSync(join(dir, 'build', 'ios', 'iphonesimulator', '*.app'));
    if (apps.length > 0) {
      return newest(apps);
    }
    throw new Error(`No iOS .app found under ${join(dir, 'build', 'ios')}. Build the fixture or set FLUTTER_APP_PATH.`);
  }
  const standard = join(dir, 'build', 'app', 'outputs', 'flutter-apk', 'app-debug.apk');
  if (existsSync(standard)) {
    return standard;
  }
  const candidates = globSync(join(dir, 'build', '**', '*.apk'));
  if (candidates.length > 0) {
    return newest(candidates);
  }
  throw new Error(
    `No Flutter APK found under ${join(dir, 'build')}. Build the fixture (flutter build apk --debug) or set FLUTTER_APP_PATH.`,
  );
}

const appPath = resolveAppPath(appDir);
if (!existsSync(appPath)) {
  throw new Error(`Flutter app artifact does not exist: ${appPath}. Make sure the fixture is built.`);
}

const testType = (process.env.TEST_TYPE as string) || 'standard';
let specs: string[] = [];
let exclude: string[] = [];
switch (testType) {
  case 'deeplink':
    specs = ['./test/flutter/deeplink.spec.ts'];
    break;
  default:
    specs = ['./test/flutter/*.spec.ts'];
    exclude = ['./test/flutter/deeplink.spec.ts'];
    break;
}

const flutterServiceOptions: FlutterServiceOptions = {
  platform: isIos ? 'iOS' : 'Android',
  // Forward the device (logcat/syslog) logs into the WDIO log on each test.
  captureBackendLogs: true,
};

type FlutterCapability = {
  platformName: 'Android' | 'iOS';
  'appium:automationName': 'Flutter';
  'appium:app': string;
  'appium:newCommandTimeout': number;
  'appium:deviceName'?: string;
  'appium:dartVmServicePort'?: number;
  'appium:wdaLaunchTimeout'?: number;
  'appium:simulatorStartupTimeout'?: number;
  'appium:derivedDataPath'?: string;
  'appium:usePrebuiltWDA'?: boolean;
  'wdio:flutterServiceOptions': FlutterServiceOptions;
};

const capabilities: FlutterCapability[] = [
  {
    platformName: isIos ? 'iOS' : 'Android',
    'appium:automationName': 'Flutter',
    'appium:app': appPath,
    'appium:newCommandTimeout': 240,
    // iOS: appium-flutter-driver wraps appium-xcuitest, which launches WebDriverAgent. CI
    // pre-builds WDA into FLUTTER_WDA_DD; reuse it (usePrebuiltWDA) so the first session just
    // launches it — fast, no per-session compile (which under WDIO's undici client dropped the
    // POST /session socket on the RN leg). Generous sim-boot ceiling for cold/slow runners.
    ...(isIos
      ? {
          'appium:deviceName': process.env.FLUTTER_IOS_DEVICE ?? 'iPhone 16',
          'appium:simulatorStartupTimeout': 240000,
          'appium:wdaLaunchTimeout': process.env.FLUTTER_WDA_DD ? 180000 : 720000,
          ...(process.env.FLUTTER_WDA_DD
            ? { 'appium:derivedDataPath': process.env.FLUTTER_WDA_DD, 'appium:usePrebuiltWDA': true }
            : {}),
        }
      : {}),
    'wdio:flutterServiceOptions': flutterServiceOptions,
  },
];

const logDir = join(__dirname, 'logs', getLogDirName(testType, 'flutter'));

export const config = {
  runner: 'local',
  specs,
  exclude,
  // One emulator/sim per CI job; multiremote is exercised by unit tests, not here.
  maxInstances: 1,
  capabilities,
  logLevel: 'info',
  bail: 0,
  // One spec retry to absorb transient mobile-CI flake (emulator boot, first-session attach).
  specFileRetries: 1,
  specFileRetriesDeferred: false,
  baseUrl: '',
  waitforTimeout: 15000,
  // iOS must exceed wdaLaunchTimeout so WDIO doesn't abort POST /session before WDA is ready;
  // with a prebuilt WDA (CI) the session is fast, so a tighter 7-min ceiling surfaces a flaky
  // first session quickly. Android stays tight.
  connectionRetryTimeout: isIos ? (process.env.FLUTTER_WDA_DD ? 420000 : 900000) : 180000,
  connectionRetryCount: 0,
  // @wdio/appium-service boots Appium; @wdio/flutter-service prepares the capability
  // (automationName Flutter) and attaches the Dart VM Service for execute/mock.
  services: ['appium', 'flutter'],
  port: 4723,
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 120000,
    retries: 0,
  },
  outputDir: logDir,
  // App-ready gate: wait for the fixture's increment button before any spec runs, so the
  // FLUTTER context + widget tree are live and the first spec doesn't bear the boot cost.
  before: async () => {
    const { browser } = await import('@wdio/globals');
    // Already-in-FLUTTER is fine; some drivers throw on a redundant switch. Optional-chain the
    // catch too: if switchContext is somehow absent, `?.('FLUTTER')` is undefined and a bare
    // `.catch` would itself throw — `?.catch` short-circuits the whole expression instead.
    await browser.switchContext?.('FLUTTER')?.catch(() => undefined);
    // The FLUTTER context needs a JSON-serialised finder (an accessibility-id `~` selector is a
    // silent no-op here) — match what browser.flutter.byValueKey produces. NOT swallowed: this
    // is a real gate, so a never-ready app fails fast instead of every spec timing out later.
    const increment = JSON.stringify({ finderType: 'ByValueKey', keyValueString: 'increment', keyValueType: 'String' });
    await browser.$(increment).waitForDisplayed({ timeout: 90000 });
  },
  // On failure, dump the Appium page source to a .log artifact for diagnosis.
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
    } catch {
      // best-effort diagnostic; never let it mask the real test failure
    }
  },
};
