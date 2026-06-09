import { existsSync, globSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ElectrobunCapabilities, ElectrobunServiceOptions } from '@wdio/native-types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Resolve the built Electrobun app for the package-install smoke test.
 *
 * macOS/Linux build with CEF, Windows with the native WebView2 renderer; the package-test CI
 * jobs run on macOS + Windows. Electrobun writes a `build/<environment>/<AppName>.app` bundle
 * on macOS (the environment subdir isn't fixed across the beta toolchain, so glob for the
 * newest top-level `.app`; helper bundles nested under `…/Contents/…` are filtered out) and
 * `build/<environment>/<App>/bin/launcher[.exe]` on Windows/Linux. `ELECTROBUN_APP_PATH`
 * overrides for local runs.
 */
function resolveAppBinaryPath(): string {
  const override = process.env.ELECTROBUN_APP_PATH;
  if (override) {
    return override;
  }
  const buildDir = join(__dirname, 'build');
  if (!existsSync(buildDir)) {
    throw new Error(`Electrobun build directory not found: ${buildDir}. Run \`pnpm build\` in this fixture first.`);
  }
  const newestBy = (paths: string[]) => {
    const mtime = (p: string) => {
      try {
        return statSync(p).mtimeMs;
      } catch {
        return 0;
      }
    };
    return paths.map((path) => ({ path, mtime: mtime(path) })).sort((a, b) => b.mtime - a.mtime)[0].path;
  };
  if (process.platform === 'darwin') {
    const bundles = globSync(join(buildDir, '**', '*.app')).filter((p) => !/\.app[\\/]/.test(p));
    if (bundles.length === 0) {
      throw new Error(
        `No Electrobun .app bundle found under ${buildDir}. Set ELECTROBUN_APP_PATH to the built bundle.`,
      );
    }
    return newestBy(bundles);
  }
  const launcherName = process.platform === 'win32' ? 'launcher.exe' : 'launcher';
  const launchers = globSync(join(buildDir, '**', 'bin', launcherName));
  if (launchers.length === 0) {
    throw new Error(
      `No Electrobun launcher (bin/${launcherName}) found under ${buildDir}. Set ELECTROBUN_APP_PATH to the built launcher.`,
    );
  }
  return newestBy(launchers);
}

const appBinaryPath = resolveAppBinaryPath();

const electrobunServiceOptions: ElectrobunServiceOptions = {
  appBinaryPath,
  captureBackendLogs: true,
  backendLogLevel: 'info',
};

type ElectrobunCapability = ElectrobunCapabilities & {
  // Standard W3C capability not on the (intentionally minimal) ElectrobunCapabilities
  // interface — pins Chromedriver to CEF's Chromium major.
  browserVersion?: string;
  'wdio:electrobunServiceOptions': ElectrobunServiceOptions;
};

const capabilities: ElectrobunCapability[] = [
  {
    // The launcher rewrites 'electrobun' → 'chrome' (CEF/macOS) or 'MicrosoftEdge'
    // (WebView2/Windows) + sets debuggerAddress in onWorkerStart. CEF pins the Chromium major
    // (147) so WDIO doesn't fetch a newer Chromedriver that refuses to attach; the Windows
    // WebView2/Edge path omits the pin (the launcher pins browserVersion to the detected
    // WebView2 runtime version, which msedgedriver must match) and forces classic WebDriver —
    // Edge's default BiDi resets the page to about:blank, hiding the content target.
    browserName: 'electrobun',
    ...(process.platform === 'win32' ? { 'wdio:enforceWebDriverClassic': true } : { browserVersion: '147' }),
    'wdio:electrobunServiceOptions': electrobunServiceOptions,
  },
];

export const config = {
  runner: 'local',
  specs: ['./test/**/*.spec.ts'],
  exclude: [],
  // Single-instance: multiremote is blocked upstream (CEF can't isolate ≥2 instances).
  maxInstances: 1,
  capabilities,
  logLevel: 'info',
  bail: 0,
  baseUrl: '',
  waitforTimeout: 10000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,
  // Residual upstream CEF race (same as the e2e conf): an app instance can occasionally
  // come up with the main view unpainted (failed-profile → global-context fallback).
  // mochaOpts.retries can't escape it (same instance); a spec-FILE retry re-spawns a fresh
  // CEF instance.
  specFileRetries: 2,
  specFileRetriesDeferred: false,
  autoXvfb: false,
  outputDir: join(__dirname, 'logs'),
  services: ['electrobun'],
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
    retries: 2,
  },
  tsConfigPath: join(__dirname, 'tsconfig.wdio.json'),
};
