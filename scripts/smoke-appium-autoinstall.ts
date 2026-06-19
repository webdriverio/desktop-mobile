#!/usr/bin/env node
/**
 * Clean-env smoke for `autoInstallDriver` (issue #378).
 *
 * The e2e/package-test envs have the Appium drivers as `node_modules` deps, and Appium loads
 * those ahead of `APPIUM_HOME` — so there `ensureAppiumDriver` always reports `'found'` and the
 * install path is never exercised. This smoke creates a clean dir with ONLY `appium` installed
 * (no driver) and a fresh `APPIUM_HOME`, then asserts `ensureAppiumDriver(..., {
 * autoInstallDriver: true })` actually installs the driver and it shows up afterwards.
 *
 * Run via `pnpm run smoke:autoinstall-driver` (needs `@wdio/native-mobile-core` built).
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const DRIVER = 'uiautomator2';
const APPIUM_SPEC = 'appium@^3.5.0';

/** The slice of `@wdio/native-mobile-core` this smoke uses. */
interface NativeMobileCore {
  ensureAppiumDriver: (
    name: string,
    opts: { autoInstallDriver?: boolean; source?: string },
  ) => Promise<{ ok: true; value: { name: string; method: string } } | { ok: false; error: Error }>;
  listInstalledDrivers: () => string[];
  resetInstalledCache: () => void;
}

function fail(message: string): never {
  console.error(`❌ autoInstallDriver smoke failed: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  // Import the built dist by path (not the package name): @wdio/native-mobile-core isn't a
  // root dependency, and the dist only exists after the smoke job's build step — so a
  // compile-time-resolved import would also break `typecheck:scripts` in the lint job.
  const distUrl = pathToFileURL(
    join(import.meta.dirname, '..', 'packages', 'native-mobile-core', 'dist', 'esm', 'index.js'),
  ).href;
  const { ensureAppiumDriver, listInstalledDrivers, resetInstalledCache } = (await import(distUrl)) as NativeMobileCore;

  const work = mkdtempSync(join(tmpdir(), 'autoinstall-smoke-'));
  process.env.APPIUM_HOME = mkdtempSync(join(tmpdir(), 'appium-home-'));

  // Clean dir with ONLY appium — no driver in node_modules to shadow APPIUM_HOME.
  writeFileSync(join(work, 'package.json'), JSON.stringify({ name: 'autoinstall-driver-smoke', private: true }));
  console.log(`Installing ${APPIUM_SPEC} into a clean dir (${work})...`);
  execFileSync('npm', ['install', APPIUM_SPEC, '--no-audit', '--no-fund', '--loglevel', 'error'], {
    cwd: work,
    stdio: 'inherit',
  });

  // ensureAppiumDriver resolves the appium CLI + driver list from process.cwd().
  process.chdir(work);

  resetInstalledCache();
  if (listInstalledDrivers().includes(DRIVER)) {
    fail(`precondition: '${DRIVER}' already present in a fresh APPIUM_HOME`);
  }

  const result = await ensureAppiumDriver(DRIVER, { autoInstallDriver: true });
  if (!result.ok) {
    fail(`ensureAppiumDriver returned Err: ${result.error.message}`);
  }
  if (result.value.method !== 'installed') {
    fail(`expected method 'installed', got '${result.value.method}'`);
  }

  resetInstalledCache();
  if (!listInstalledDrivers().includes(DRIVER)) {
    fail(`'${DRIVER}' not present after install`);
  }

  console.log(`✅ autoInstallDriver smoke: '${DRIVER}' installed via ensureAppiumDriver`);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
