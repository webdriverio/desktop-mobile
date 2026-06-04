import { existsSync, globSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ElectrobunCapabilities, ElectrobunServiceOptions } from '@wdio/native-types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Resolve the built Electrobun `.app` bundle for the package-install smoke test.
 *
 * macOS-only: `@wdio/electrobun-service` is macOS-only in 0.x (Linux/Windows CEF is
 * upstream-blocked), and the package-test CI job runs on macOS only. Electrobun writes
 * the bundle under `build/<environment>/<AppName>.app`; the environment subdir isn't fixed
 * across the beta toolchain, so glob for the newest top-level `.app` (helper bundles nested
 * inside `…/Contents/…` are filtered out). `ELECTROBUN_APP_PATH` overrides for local runs.
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
  const bundles = globSync(join(buildDir, '**', '*.app')).filter((p) => !/\.app[\\/]/.test(p));
  if (bundles.length === 0) {
    throw new Error(`No Electrobun .app bundle found under ${buildDir}. Set ELECTROBUN_APP_PATH to the built bundle.`);
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
  return newestBy(bundles);
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
    // Idiomatic, like the sibling services (browserName: 'tauri'/'dioxus'): the launcher
    // rewrites 'electrobun' → 'chrome' + sets debuggerAddress in onWorkerStart. Pin the
    // driver to CEF's Chromium major (147) so WDIO doesn't fetch a newer Chromedriver that
    // refuses to attach. Bump alongside the Electrobun/CEF pin.
    browserName: 'electrobun',
    browserVersion: '147',
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
