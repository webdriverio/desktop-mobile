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
// see the agent-os plan "Framework gaps"). Electrobun is single-instance for now.
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
  // CDP-attach: the launcher rewrites this 'electrobun' → 'chrome' (CEF/macOS) or
  // 'MicrosoftEdge' (WebView2/Windows) and sets the debuggerAddress onto the
  // capability in onWorkerStart.
  browserName: 'electrobun',
  // CEF (macOS) bundles Chromium 147 (147.0.7727.118); pin the driver to that major
  // so WDIO doesn't fetch the latest (148+), which refuses to attach with "only
  // supports Chrome version N". Matching the major is what matters (spike
  // RESEARCH_FINDINGS §2). Bump alongside the Electrobun/CEF pin. On Windows the
  // WebView2 (Edge) path omits this so WDIO/edgedriver match the runner's installed
  // Edge/WebView2 runtime instead. It also forces CLASSIC WebDriver: Edge defaults to
  // WebDriver BiDi, whose session resets the app's only webview to about:blank (a
  // "BiDi-CDP Mapper" target appears and the content target vanishes), so the CDP bridge
  // finds no content. Classic attach leaves the `views://` page intact, as chromedriver
  // does for CEF.
  ...(process.platform === 'win32' ? { 'wdio:enforceWebDriverClassic': true } : { browserVersion: '147' }),
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
  // that app instance's whole lifetime (see the plan "Framework gaps"). mochaOpts.retries
  // can't escape it (same instance); a spec-FILE retry re-spawns a fresh CEF instance.
  // Bumped to 3 (4 attempts/spec) — at 2 the gate occasionally exhausted retries on a
  // run with an elevated CEF-timeout rate. Drop back once the upstream fix lands.
  specFileRetries: 3,
  specFileRetriesDeferred: false,
  baseUrl: '',
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  // Electrobun is CDP-attach: the app binary is spawned from the worker process
  // (no separate driver in the launcher needing a display), so the Electron
  // headless approach applies — let @wdio/xvfb auto-manage Xvfb on Linux rather
  // than wrapping the whole command with xvfb-run (the Wry tauri/dioxus path).
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
