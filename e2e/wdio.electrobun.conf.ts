import { existsSync, globSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ElectrobunCapabilities, ElectrobunServiceOptions } from '@wdio/native-types';

import { getLogDirName } from './lib/utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const appDir = join(__dirname, '..', 'fixtures', 'e2e-apps', 'electrobun');

/**
 * Locate the built Electrobun `.app` bundle.
 *
 * Electrobun is CDP-attach (like Electron, unlike the Wry-based Tauri/Dioxus): the
 * launcher spawns the binary and the worker attaches over CDP, so we hand the
 * service the bundle path via `appBinaryPath` exactly as the Electron config hands
 * it a resolved binary.
 *
 * Electrobun writes the bundle under `build/<environment>/<AppName>.app` and the
 * environment subdir (dev/canary/stable) is not fixed across the beta toolchain,
 * so we glob for the first `.app` rather than hardcoding a subpath. CI can pin an
 * exact bundle via `ELECTROBUN_APP_PATH` (set after the build step) to avoid any
 * ambiguity. macOS is the only validated platform (see the service's
 * RESEARCH_FINDINGS); the Windows/Linux bundle layout is unverified.
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

  // Newest-built wins when the toolchain emits more than one environment dir
  // (dev / canary / stable), rather than a lexicographic pick. Stat each candidate
  // once up front — not inside the comparator, which would re-stat O(n log n) times —
  // and tolerate a path that races away between glob and stat.
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
    // macOS: a `.app` bundle (the binary lives in Contents/MacOS). `**/*.app` also
    // matches helper bundles nested INSIDE the main app
    // (`…/Contents/Frameworks/bun Helper (GPU).app`) — those have no CEF framework,
    // so keep only top-level `.app`s or we'd resolve appBinaryPath to a helper.
    const bundles = globSync(join(buildDir, '**', '*.app')).filter((p) => !/\.app[\\/]/.test(p));
    if (bundles.length > 0) {
      return newest(bundles);
    }
    throw new Error(
      `No Electrobun .app bundle found under ${buildDir}. ` +
        'Set ELECTROBUN_APP_PATH to the built app bundle (or its inner binary).',
    );
  }

  // Linux/Windows: electrobun emits `build/<env>/<App>/bin/launcher[.exe]` with a
  // sibling `Resources/build.json` (no `.app`), so glob for the launcher binary. The
  // helper executables are named `bun Helper (…)`, never `launcher`, so this can't
  // match a helper.
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
// Pinned to 1: multiremote is blocked upstream (CEF can't isolate ≥2 instances —
// see #320). Electrobun is single-instance for now.
let maxInstances = 1;

// CI runs ONLY `standard` (see ci.yml — the macOS matrix is `['standard']`). The
// `window` (multi-window) and `deeplink` cases are kept for LOCAL runs
// (`TEST_TYPE=window|deeplink`) but are not wired into CI: both hit upstream CEF
// gaps (per-window partition / no open-url routing) documented in their spec files.
switch (testType) {
  case 'window':
    specs = ['./test/electrobun/window.spec.ts'];
    break;
  case 'multiremote':
    // Two independent instances in one worker — WebView2 isolates each (per-instance data
    // dir), which CEF can't, so this runs on Windows only.
    specs = ['./test/electrobun/multiremote/*.spec.ts'];
    break;
  case 'deeplink':
    // Deeplink tests dispatch the OS protocol handler and must not race parallel apps.
    specs = ['./test/electrobun/deeplink.spec.ts'];
    maxInstances = 1;
    break;
  default:
    specs = ['./test/electrobun/*.spec.ts'];
    // window: enumerates the two CEF page targets; runs in its own pass.
    // deeplink: macOS-only, single-instance, dispatches the OS protocol handler.
    exclude = ['./test/electrobun/window.spec.ts', './test/electrobun/deeplink.spec.ts'];
    break;
}

type ElectrobunCapability = ElectrobunCapabilities & {
  'wdio:electrobunServiceOptions': ElectrobunServiceOptions;
};

const electrobunServiceOptions: ElectrobunServiceOptions = {
  appBinaryPath,
  appArgs: ['foo', 'bar=baz'],
  // Forward the Bun backend's stdout/stderr into the WDIO log for the logging spec.
  captureBackendLogs: true,
  backendLogLevel: 'info',
};

const baseCapability: ElectrobunCapability = {
  // The launcher rewrites this 'electrobun' per platform: → 'chrome' (CEF/macOS, CDP),
  // 'MicrosoftEdge' (WebView2/Windows, CDP), or deletes it and points hostname/port at
  // WebKitWebDriver (WebKitGTK/Linux, W3C) — all in onPrepare/onWorkerStart.
  browserName: 'electrobun',
  // macOS/CEF bundles a specific Chromium major; pin the driver to it so WDIO doesn't fetch a
  // newer major that refuses to attach ("only supports Chrome version N"). Bump alongside the
  // Electrobun/CEF pin. Windows (WebView2) and Linux (WebKitGTK) DON'T pin a browserVersion:
  //  - Windows: the launcher pins msedgedriver to the detected WebView2 *runtime* version, and
  //    forces CLASSIC WebDriver (Edge's default BiDi session resets the webview to about:blank).
  //  - Linux: WebKitWebDriver is a classic W3C driver the launcher connects to directly — a
  //    Chromium browserVersion is meaningless. Classic is forced (here + by the launcher).
  ...(process.platform === 'darwin' ? { browserVersion: '147' } : { 'wdio:enforceWebDriverClassic': true }),
  'wdio:electrobunServiceOptions': electrobunServiceOptions,
};

// Multiremote drives two independent instances in one worker (each gets its own WebView2
// process, port, and data dir); the other test types use the single-instance array shape.
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
  // Residual upstream CEF race on the macOS `standard` suite: the 2-window fixture
  // (needed because a single CEF window doesn't reliably expose a `/json` target) trips CEF's
  // failed-profile → global-context fallback, which surfaces as either an unpainted
  // `#app-title` or a "Timeout of new browser info response" on the second frame — for
  // that app instance's whole lifetime (see #320). mochaOpts.retries
  // can't escape it (same instance); a spec-FILE retry re-spawns a fresh CEF instance.
  // Bumped to 3 (4 attempts/spec) — at 2 the gate occasionally exhausted retries on a
  // run with an elevated CEF-timeout rate. Drop back once the upstream fix lands.
  specFileRetries: 3,
  specFileRetriesDeferred: false,
  baseUrl: '',
  waitforTimeout: 10000,
  // On Linux/WebKitGTK a New Session (which launches the app under the driver) very
  // occasionally hangs the full timeout before attaching (~1 in 6 specs). Fail that fast (45s —
  // a healthy New Session is a few seconds) so the spec-file retry re-spawns a fresh app rather
  // than burning the full 120s per attempt. macOS/Windows (CDP-attach) keep 120s.
  connectionRetryTimeout: process.platform === 'linux' ? 45_000 : 120_000,
  connectionRetryCount: 3,
  // autoXvfb lets @wdio/xvfb manage Xvfb for the worker process on Linux (the Electron
  // headless approach). macOS CEF / Windows WebView2 are CDP-attach and need nothing more.
  // The Linux WebKitGTK path spawns WebKitWebDriver from the launcher (which then launches the
  // app) — autoXvfb does NOT cover launcher-spawned processes, so the service wraps that driver
  // in `xvfb-run -a` itself (webkitDriver.ts), mirroring the CEF app spawn in nativeMode.ts.
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
