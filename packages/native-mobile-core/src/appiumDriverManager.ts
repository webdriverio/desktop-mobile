// Chromedriver-style Appium driver auto-management.
//
// `@wdio/electron-service` resolves a chromedriver matched to the browser with zero user
// config; the mobile analog is ensuring the Appium driver a service needs is installed,
// at a version known-good for the running Appium *server* major (see `versionMatrix.ts`).
//
// Opt-in (`autoInstallDriver`, default off — CI manages drivers explicitly and may lack
// network/permissions) and idempotent (an already-installed driver is a no-op). Modeled on
// `@wdio/tauri-service`'s `driverManager.ts` (`ensureTauriDriver`): PATH/node_modules
// detection, `Result<>` returns, `spawn` for the install.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger, Err, Ok, type Result } from '@wdio/native-utils';
import { type DriverSpec, driverSpecFor, supportedAppiumMajors } from './versionMatrix.js';

const log = createLogger('native-mobile-core', 'launcher');

export interface AppiumDriverInstallSuccess {
  name: string;
  method: 'found' | 'installed' | 'skipped';
}

export type AppiumDriverInstallResult = Result<AppiumDriverInstallSuccess, Error>;

export interface EnsureAppiumDriverOptions {
  /** Opt-in gate — when falsy, ensure is a no-op (`'skipped'`). Default off. */
  autoInstallDriver?: boolean;
  /** Escape hatch: override the matrix npm source (e.g. a published fork). */
  source?: string;
  /** Hard cap on the `appium driver install` spawn — killed past this so onPrepare can't hang. Default 5 min. */
  timeoutMs?: number;
}

const DEFAULT_INSTALL_TIMEOUT_MS = 300000;

const isWindows = process.platform === 'win32';

/**
 * Resolve the `appium` CLI. Prefer the project-local `node_modules/.bin/appium` (the
 * `@wdio/appium-service` dependency), falling back to PATH — Appium loads `node_modules`
 * drivers ahead of `APPIUM_HOME`, so the local binary is also the one that sees them.
 */
export function resolveAppiumBin(): string {
  const localBins = isWindows
    ? [
        join(process.cwd(), 'node_modules', '.bin', 'appium.cmd'),
        join(process.cwd(), 'node_modules', '.bin', 'appium.exe'),
      ]
    : [join(process.cwd(), 'node_modules', '.bin', 'appium')];
  for (const bin of localBins) {
    if (existsSync(bin)) {
      return bin;
    }
  }
  return 'appium';
}

/** Parse `appium --version` output (a bare semver line) into its major. */
export function getAppiumVersion(): { raw: string; major: number } | undefined {
  try {
    const raw = execFileSync(resolveAppiumBin(), ['--version'], { encoding: 'utf8', stdio: 'pipe' }).trim();
    const match = raw.match(/(\d+)\.\d+\.\d+/);
    if (!match) {
      return undefined;
    }
    return { raw: match[0], major: Number.parseInt(match[1], 10) };
  } catch {
    return undefined;
  }
}

export function isAppiumAvailable(): boolean {
  return getAppiumVersion() !== undefined;
}

/** Extract installed driver short-names from `appium driver list --installed --json` output. */
export function parseInstalledDrivers(json: string): string[] {
  // `--json` prints a single JSON object keyed by driver short-name; tolerate leading log noise.
  const start = json.indexOf('{');
  if (start === -1) {
    return [];
  }
  try {
    const parsed = JSON.parse(json.slice(start)) as Record<string, unknown>;
    return Object.keys(parsed);
  } catch {
    return [];
  }
}

let installedCache: string[] | undefined;

/** Installed Appium drivers (short-names), cached per-process — the idempotency check. */
export function listInstalledDrivers(): string[] {
  if (installedCache) {
    return installedCache;
  }
  try {
    const out = execFileSync(resolveAppiumBin(), ['driver', 'list', '--installed', '--json'], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    installedCache = parseInstalledDrivers(out);
  } catch (error) {
    log.debug(`Could not list installed Appium drivers: ${(error as Error).message}`);
    installedCache = [];
  }
  return installedCache;
}

/** Clear the installed-driver cache (after an install, or for tests). */
export function resetInstalledCache(): void {
  installedCache = undefined;
}

/** Install a driver via `appium driver install --source=npm <source>@<version>`. */
export function installAppiumDriver(spec: DriverSpec, timeoutMs: number = DEFAULT_INSTALL_TIMEOUT_MS): Promise<void> {
  log.info(`Installing Appium driver '${spec.name}' (${spec.source}@${spec.version})...`);
  return new Promise((resolve, reject) => {
    const proc = spawn(resolveAppiumBin(), ['driver', 'install', '--source=npm', `${spec.source}@${spec.version}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      // Hard cap: a slow registry / TLS stall would otherwise block onPrepare forever.
      timeout: timeoutMs,
    });
    let stderr = '';
    proc.stdout?.on('data', (d: Buffer) => log.debug(d.toString().trim()));
    proc.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
      log.debug(d.toString().trim());
    });
    proc.on('close', (code, signal) => {
      if (code === 0) {
        log.info(`Installed Appium driver '${spec.name}'.`);
        resolve();
      } else {
        // The timeout above kills the spawn by signal, leaving code null — report the signal
        // so the failure reads as a timeout-kill rather than the opaque "failed with code null".
        const reason = signal ? `signal ${signal}` : `code ${code}`;
        reject(new Error(`appium driver install ${spec.name} failed with ${reason}: ${stderr.trim()}`));
      }
    });
    proc.on('error', (error) => reject(new Error(`Failed to spawn appium driver install: ${error.message}`)));
  });
}

/**
 * Ensure the Appium driver `name` is installed at a version known-good for the running
 * Appium server major. Opt-in via `autoInstallDriver`; idempotent.
 *
 *   1. `autoInstallDriver` off            → Ok({ method: 'skipped' })
 *   2. `appium` not resolvable            → Err (clear message)
 *   3. driver already installed           → Ok({ method: 'found' })
 *   4. no matrix entry for (name, major)  → Err (update the matrix)
 *   5. install                            → Ok({ method: 'installed' }) | Err
 */
export async function ensureAppiumDriver(
  name: string,
  options: EnsureAppiumDriverOptions = {},
): Promise<AppiumDriverInstallResult> {
  if (!options.autoInstallDriver) {
    return Ok({ name, method: 'skipped' });
  }

  const appium = getAppiumVersion();
  if (!appium) {
    return Err(
      new Error(
        `Cannot auto-install the '${name}' Appium driver: the 'appium' CLI is not resolvable. ` +
          'Add @wdio/appium-service (which brings appium) to your project, or install drivers manually.',
      ),
    );
  }

  if (listInstalledDrivers().includes(name)) {
    log.debug(`Appium driver '${name}' already installed.`);
    return Ok({ name, method: 'found' });
  }

  const spec = driverSpecFor(name, appium.major);
  if (!spec) {
    return Err(
      new Error(
        `No known-good version for Appium driver '${name}' on Appium ${appium.raw} (major ${appium.major}). ` +
          `The version matrix covers Appium major(s): ${supportedAppiumMajors().join(', ')}. ` +
          'Install the driver manually or update APPIUM_MATRIX.',
      ),
    );
  }

  const effectiveSpec = options.source ? { ...spec, source: options.source } : spec;
  try {
    await installAppiumDriver(effectiveSpec, options.timeoutMs);
    resetInstalledCache();
    return Ok({ name, method: 'installed' });
  } catch (error) {
    return Err(error instanceof Error ? error : new Error(String(error)));
  }
}
