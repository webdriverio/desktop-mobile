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
  'appium:usePreinstalledWDA'?: boolean;
  'appium:prebuiltWDAPath'?: string;
  'appium:wdaStartupRetries'?: number;
  'appium:wdaStartupRetryInterval'?: number;
  'wdio:flutterServiceOptions': FlutterServiceOptions;
};

const capabilities: FlutterCapability[] = [
  {
    platformName: isIos ? 'iOS' : 'Android',
    'appium:automationName': 'Flutter',
    'appium:app': appPath,
    'appium:newCommandTimeout': 240,
    // No dartVmServicePort pin: the engine ignores the launch-flag port pin (it always binds a
    // random, auth-coded port), so @wdio/flutter-service discovers the VM Service by asking the
    // driver for the URL it already connected to (flutter:getVMServiceUrl) rather than pinning.
    // iOS: appium-flutter-driver wraps appium-xcuitest, which launches WebDriverAgent. CI
    // pre-builds WDA into FLUTTER_WDA_DD; reuse it (usePreinstalledWDA — simctl install/launch) so
    // the first session just launches it — fast, no per-session xcodebuild (which under WDIO's
    // undici client dropped the POST /session socket on the RN leg). Generous sim-boot ceiling for
    // cold/slow runners.
    ...(isIos
      ? {
          'appium:deviceName': process.env.FLUTTER_IOS_DEVICE ?? 'iPhone 16',
          'appium:simulatorStartupTimeout': 240000,
          // Prebuilt WDA just launches (no compile), so a tight per-attempt ceiling lets several
          // startup retries fit inside connectionRetryTimeout below; non-prebuilt (local) must
          // allow the multi-minute compile.
          'appium:wdaLaunchTimeout': process.env.FLUTTER_WDA_DD ? 120000 : 720000,
          // WDA on GitHub-Actions sims often fails to come up on the first attempt (ECONNREFUSED
          // 8100 / session-create timeout). appium's default is only 2 startup retries — bump it.
          'appium:wdaStartupRetries': 5,
          'appium:wdaStartupRetryInterval': 20000,
          // usePreinstalledWDA simctl-installs + launches the CI-prebuilt Runner.app WITHOUT any
          // xcodebuild at session time (the reusable strips its embedded XCTest frameworks). That
          // keeps POST /session short — usePrebuiltWDA still shells out to `xcodebuild test`, whose
          // multi-minute first launch overran undici's ~300s socket cap → UND_ERR_SOCKET on cold
          // sessions. Path is the prebuilt runner the workflow leaves under FLUTTER_WDA_DD.
          ...(process.env.FLUTTER_WDA_DD
            ? {
                'appium:usePreinstalledWDA': true,
                'appium:prebuiltWDAPath': `${process.env.FLUTTER_WDA_DD}/Build/Products/Debug-iphonesimulator/WebDriverAgentRunner-Runner.app`,
              }
            : {}),
        }
      : {}),
    'wdio:flutterServiceOptions': flutterServiceOptions,
  },
];

const logDir = join(__dirname, 'logs', getLogDirName(testType, 'flutter'));
// Create it up front so @wdio/appium-service can write wdio-appium.log here from session start —
// otherwise a fast session failure leaves the dir absent and the Appium server log (which carries
// the `am start` intent + driver discovery) never reaches the uploaded artifact.
mkdirSync(logDir, { recursive: true });

export const config = {
  runner: 'local',
  specs,
  exclude,
  // One emulator/sim per CI job; multiremote is exercised by unit tests, not here.
  maxInstances: 1,
  capabilities,
  logLevel: 'info',
  bail: 0,
  // Two spec retries for transient test-level flakes. NOT a fix for the iOS sim launch-wedge: a
  // session-create timeout kills the worker in a way specFileRetries does not re-run (verified — a
  // wedged spec is reported failed with no extra worker run), and deferring made no difference. The
  // cold-sim launch wedge is handled up front by the warm-up GATE in the iOS reusable instead.
  specFileRetries: 2,
  specFileRetriesDeferred: false,
  baseUrl: '',
  waitforTimeout: 15000,
  // iOS: generous per-command ceiling, but kept below the inflated value that fed cold
  // session-create — with usePreinstalledWDA there's no in-session xcodebuild, so POST /session
  // lands inside undici's ~300s socket cap and doesn't need the WDA-compile budget. Without a
  // prebuilt WDA (local) it stays generous; Android tight.
  connectionRetryTimeout: isIos ? (process.env.FLUTTER_WDA_DD ? 420000 : 900000) : 180000,
  connectionRetryCount: 0,
  // @wdio/appium-service boots Appium; @wdio/flutter-service prepares the capability
  // (automationName Flutter) and attaches the Dart VM Service for execute/mock.
  services: [['appium', { logPath: logDir }], 'flutter'],
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
    // Gate on a base64-encoded appium-flutter-finder via `flutter:waitFor`, NOT browser.$()
    // .waitForDisplayed — appium-flutter-driver doesn't implement findElement, and a raw JSON
    // string is base64-decoded to garbage. NOT swallowed: this is a real gate, so a never-ready
    // app fails fast instead of every spec timing out later.
    const increment = Buffer.from(
      JSON.stringify({ finderType: 'ByValueKey', keyValueString: 'increment', keyValueType: 'String' }),
    ).toString('base64');
    await browser.execute('flutter:waitFor', increment, 90000);
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
