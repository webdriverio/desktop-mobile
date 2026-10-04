import { existsSync, globSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ElectrobunCapabilities, ElectrobunServiceOptions } from '@wdio/native-types';

import { getLogDirName } from './lib/utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const appDir = join(__dirname, '..', 'fixtures', 'e2e-apps', 'electrobun');

/**
 * Locate the built Electrobun app bundle.
 *
 * The `build/<environment>/` subdir (dev/canary/stable) isn't fixed across the beta
 * toolchain, so glob for the bundle rather than hardcoding a subpath; CI can pin an
 * exact one via `ELECTROBUN_APP_PATH`.
 */
function resolveElectrobunAppPath(dir: string): string {
  const override = process.env.ELECTROBUN_APP_PATH;
  if (override) {
    return override;
  }

  const buildDir = join(dir, 'build');
  if (!existsSync(buildDir)) {
    throw new Error(
      `Electrobun build directory not found: ${buildDir}. ` +
        'Run `electrobun build` in fixtures/e2e-apps/electrobun first ' +
        '(or set ELECTROBUN_APP_PATH to the built bundle).',
    );
  }

  const newest = (paths: string[]): string => {
    const mtimeOf = (p: string): number => {
      try {
        return statSync(p).mtimeMs;
      } catch {
        return 0;
      }
    };
    return paths.map((path) => ({ path, mtime: mtimeOf(path) })).sort((a, b) => b.mtime - a.mtime)[0].path;
  };

  if (process.platform === 'darwin') {
    // `**/*.app` also matches helper bundles nested INSIDE the main app
    // (`…/Contents/Frameworks/bun Helper (GPU).app`); keep only top-level `.app`s or
    // we'd resolve appBinaryPath to a helper.
    const bundles = globSync(join(buildDir, '**', '*.app')).filter((p) => !/\.app[\\/]/.test(p));
    if (bundles.length > 0) {
      return newest(bundles);
    }
    throw new Error(
      `No Electrobun .app bundle found under ${buildDir}. ` +
        'Set ELECTROBUN_APP_PATH to the built app bundle (or its inner binary).',
    );
  }

  // Linux/Windows: electrobun emits `build/<env>/<App>/bin/launcher[.exe]`.
  const launcherName = process.platform === 'win32' ? 'launcher.exe' : 'launcher';
  const launchers = globSync(join(buildDir, '**', 'bin', launcherName));
  if (launchers.length > 0) {
    return newest(launchers);
  }
  throw new Error(
    `No Electrobun launcher (bin/${launcherName}) found under ${buildDir}. ` +
      'Set ELECTROBUN_APP_PATH to the built launcher binary.',
  );
}

const appBinaryPath = resolveElectrobunAppPath(appDir);
if (!existsSync(appBinaryPath)) {
  throw new Error(`Electrobun app path does not exist: ${appBinaryPath}. Make sure the app is built.`);
}

const testType = (process.env.TEST_TYPE as string) || 'standard';

let specs: string[] = [];
let exclude: string[] = [];
// macOS CEF is single-instance; elsewhere run 2 parallel workers (why: launcher.ts / README).
let maxInstances = process.platform === 'darwin' ? 1 : 2;

// `window` and `deeplink` run in their own passes; upstream CEF gaps on the macOS path
// keep them out of the default suite (see those spec files; per-OS CI wiring in ci.yml).
switch (testType) {
  case 'window':
    specs = ['./test/electrobun/window.spec.ts'];
    break;
  case 'multiremote':
    // Multiremote drives both instances from ONE worker.
    specs = ['./test/electrobun/multiremote/*.spec.ts'];
    maxInstances = 1;
    break;
  case 'deeplink':
    // Deeplink tests dispatch the OS protocol handler and must not race parallel apps.
    specs = ['./test/electrobun/deeplink.spec.ts'];
    maxInstances = 1;
    break;
  default:
    specs = ['./test/electrobun/*.spec.ts'];
    exclude = ['./test/electrobun/window.spec.ts', './test/electrobun/deeplink.spec.ts'];
    break;
}

type ElectrobunCapability = ElectrobunCapabilities & {
  'wdio:electrobunServiceOptions': ElectrobunServiceOptions;
};

const electrobunServiceOptions: ElectrobunServiceOptions = {
  appBinaryPath,
  appArgs: ['foo', 'bar=baz'],
  // Capture the Bun backend's stdout/stderr for the logging spec.
  captureBackendLogs: true,
  backendLogLevel: 'info',
};

const baseCapability: ElectrobunCapability = {
  // 'electrobun' is a placeholder the launcher rewrites to the real browserName per platform.
  browserName: 'electrobun',
  // macOS/CEF pins the driver to the bundled Chromium major (bump alongside the CEF pin);
  // Windows/Linux force classic WebDriver. Why, per platform: launcher.ts.
  ...(process.platform === 'darwin' ? { browserVersion: '147' } : { 'wdio:enforceWebDriverClassic': true }),
  'wdio:electrobunServiceOptions': electrobunServiceOptions,
};

const capabilities =
  testType === 'multiremote'
    ? { instanceA: { capabilities: { ...baseCapability } }, instanceB: { capabilities: { ...baseCapability } } }
    : [baseCapability];

const logDirName = getLogDirName(testType, 'electrobun');
const logDir = join(__dirname, 'logs', logDirName);

export const config = {
  runner: 'local',
  specs,
  exclude,
  maxInstances,
  capabilities,
  logLevel: 'info',
  bail: 0,
  // A spec-FILE retry re-spawns a fresh CEF instance to escape the macOS global-context
  // race (root cause: nativeMode.ts / README); mochaOpts.retries can't, since it reuses the
  // same wedged instance. Bumped to 3 (4 attempts/spec), from 2 where the gate occasionally
  // exhausted retries. Drop back once the upstream fix lands.
  specFileRetries: 3,
  specFileRetriesDeferred: false,
  baseUrl: '',
  waitforTimeout: 10000,
  // On Linux/WebKitGTK a New Session occasionally hangs the full timeout before attaching
  // (~1 in 6 specs). Fail fast at 45s (a healthy New Session takes a few seconds) so the retry
  // re-spawns a fresh app instead of burning ~120s per attempt.
  connectionRetryTimeout: process.platform === 'linux' ? 45_000 : 120_000,
  connectionRetryCount: 3,
  // Runs Xvfb for the worker process on Linux (the launcher-spawned WebKitWebDriver handles
  // its own Xvfb; see webkitDriver.ts).
  autoXvfb: true,
  services: ['electrobun'],
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
    retries: 2,
  },
  outputDir: logDir,
};
