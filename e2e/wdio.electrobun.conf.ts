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

  // macOS: a `.app` bundle. Other platforms: pin the binary via ELECTROBUN_APP_PATH
  // (the on-disk layout there is unverified — see the service RESEARCH_FINDINGS).
  // `**/*.app` also matches the helper bundles nested INSIDE the main app
  // (`…/Contents/Frameworks/bun Helper (GPU).app`, …) — those have no CEF framework,
  // so keep only top-level `.app`s or we'd resolve appBinaryPath to a helper.
  const bundles = globSync(join(buildDir, '**', '*.app')).filter((p) => !/\.app[\\/]/.test(p));
  if (bundles.length > 0) {
    // Newest-built wins when the toolchain emits more than one environment dir
    // (dev / canary / stable), rather than a lexicographic pick. Stat each path
    // once up front — not inside the comparator, which would re-stat O(n log n)
    // times — and tolerate a bundle that races away between glob and stat.
    const mtimeOf = (p: string): number => {
      try {
        return statSync(p).mtimeMs;
      } catch {
        return 0;
      }
    };
    return bundles.map((path) => ({ path, mtime: mtimeOf(path) })).sort((a, b) => b.mtime - a.mtime)[0].path;
  }

  throw new Error(
    `No Electrobun .app bundle found under ${buildDir}. ` +
      'Set ELECTROBUN_APP_PATH to the built app bundle (or its inner binary).',
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
  // Only the window suite opens the fixture's second CEF window. Two windows force
  // the persist:default/global-context race that can break either window's render
  // (see the fixture + the gated -advanced CI job), so single-window suites
  // (standard, deeplink) stay stable. The launcher forwards this env to the Bun
  // backend, which gates `new BrowserWindow` on it.
  ...(testType === 'window' ? { env: { WDIO_ELECTROBUN_SECOND_WINDOW: '1' } } : {}),
};

const capabilities: ElectrobunCapability[] = [
  {
    // CDP-attach: the launcher rewrites this to 'chrome' and sets
    // goog:chromeOptions.debuggerAddress onto the capability in onWorkerStart.
    browserName: 'chrome',
    // Electrobun 1.18.1 bundles CEF on Chromium 147 (147.0.7727.118); pin the
    // driver to that major so WDIO doesn't fetch the latest (148+), which refuses
    // to attach with "only supports Chrome version N". Matching the major is what
    // matters (spike RESEARCH_FINDINGS §2). Bump alongside the Electrobun/CEF pin.
    browserVersion: '147',
    'wdio:electrobunServiceOptions': electrobunServiceOptions,
  },
];

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
