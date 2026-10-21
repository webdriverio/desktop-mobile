#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface Fixture {
  name: string;
  packageJson: string;
  cargoToml: string;
  tauriConf: string;
}

const FIXTURES: Fixture[] = [
  {
    name: 'fixtures/e2e-apps/tauri',
    packageJson: join(__dirname, '..', 'fixtures', 'e2e-apps', 'tauri', 'package.json'),
    cargoToml: join(__dirname, '..', 'fixtures', 'e2e-apps', 'tauri', 'src-tauri', 'Cargo.toml'),
    tauriConf: join(__dirname, '..', 'fixtures', 'e2e-apps', 'tauri', 'src-tauri', 'tauri.conf.json'),
  },
  {
    name: 'fixtures/package-tests/tauri-app',
    packageJson: join(__dirname, '..', 'fixtures', 'package-tests', 'tauri-app', 'package.json'),
    cargoToml: join(__dirname, '..', 'fixtures', 'package-tests', 'tauri-app', 'src-tauri', 'Cargo.toml'),
    tauriConf: join(__dirname, '..', 'fixtures', 'package-tests', 'tauri-app', 'src-tauri', 'tauri.conf.json'),
  },
];

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface CrateVersion {
  num: string;
  yanked: boolean;
}

export interface Registry {
  npmVersions(packageName: string): string[];
  crateVersions(crateName: string): CrateVersion[];
}

export function isStableVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(version);
}

export function stableNpmVersions(versions: string[]): string[] {
  return versions.filter(isStableVersion);
}

export function stableCrateVersions(versions: CrateVersion[]): string[] {
  return versions.filter((v) => !v.yanked && isStableVersion(v.num)).map((v) => v.num);
}

function fetchNpmVersions(packageName: string): string[] {
  try {
    const output = execSync(`npm view ${packageName} versions --json`, { encoding: 'utf8' });
    return JSON.parse(output);
  } catch {
    throw new Error(`Failed to fetch versions for npm package ${packageName}`);
  }
}

function fetchCrateVersions(packageName: string): CrateVersion[] {
  // crates.io enforces a User-Agent policy (https://crates.io/data-access): a generic UA (curl's
  // default) gets a 403 with an `{ errors }` body, which previously slipped through as 0 versions.
  const userAgent = 'wdio-desktop-mobile update-tauri-version (https://github.com/webdriverio/desktop-mobile)';
  let output: string;
  try {
    output = execSync(`curl -s -A ${JSON.stringify(userAgent)} https://crates.io/api/v1/crates/${packageName}`, {
      encoding: 'utf8',
    });
  } catch (error) {
    throw new Error(`Failed to fetch versions for cargo package ${packageName}: ${(error as Error).message}`);
  }
  const info = JSON.parse(output);
  if (!Array.isArray(info.versions)) {
    // A blocked/errored request returns `{ errors: [{ detail }] }` instead of versions — surface it
    // rather than silently yielding an empty list ("No common version found").
    const detail = info?.errors?.[0]?.detail ?? 'crates.io response had no "versions" array';
    throw new Error(`Failed to fetch versions for cargo package ${packageName}: ${detail}`);
  }
  return info.versions;
}

const liveRegistry: Registry = {
  npmVersions: fetchNpmVersions,
  crateVersions: fetchCrateVersions,
};

function compareVersions(v1: string, v2: string): number {
  const parse = (v: string) => {
    const parts = v.replace(/^v/, '').split('.').map(Number);
    return { major: parts[0] || 0, minor: parts[1] || 0, patch: parts[2] || 0 };
  };
  const a = parse(v1);
  const b = parse(v2);

  if (a.major !== b.major) return b.major - a.major;
  if (a.minor !== b.minor) return b.minor - a.minor;
  return b.patch - a.patch;
}

export function findAlignedVersion(npmVersions: string[], cargoVersions: string[]): string {
  const npmSet = new Set(npmVersions);
  const cargoSet = new Set(cargoVersions);

  const sortedNpm = [...npmVersions].sort(compareVersions);

  for (const version of sortedNpm) {
    if (npmSet.has(version) && cargoSet.has(version)) {
      return version;
    }
  }

  throw new Error(`No common version found between npm and cargo`);
}

export type TauriVersions = Record<
  | 'npm:@tauri-apps/api'
  | 'npm:@tauri-apps/cli'
  | 'npm:@tauri-apps/plugin-fs'
  | 'npm:@tauri-apps/plugin-log'
  | 'cargo:tauri'
  | 'cargo:tauri-build'
  | 'cargo:tauri-plugin-fs'
  | 'cargo:tauri-plugin-log',
  string
>;

function versionsFor(core: string, build: string, fs: string, log: string, cli: string): TauriVersions {
  return {
    'npm:@tauri-apps/api': core,
    'npm:@tauri-apps/cli': cli,
    'npm:@tauri-apps/plugin-fs': fs,
    'npm:@tauri-apps/plugin-log': log,
    'cargo:tauri': core,
    'cargo:tauri-build': build,
    'cargo:tauri-plugin-fs': fs,
    'cargo:tauri-plugin-log': log,
  };
}

/** Picks the newest stable versions published on both npm and crates.io, or pins every package to `specifiedVersion`. */
export function resolveTauriVersions(registry: Registry, specifiedVersion?: string): TauriVersions {
  if (specifiedVersion) {
    return versionsFor(specifiedVersion, specifiedVersion, specifiedVersion, specifiedVersion, specifiedVersion);
  }

  const npm = (name: string) => stableNpmVersions(registry.npmVersions(name));
  const crates = (name: string) => stableCrateVersions(registry.crateVersions(name));

  const apiVersions = npm('@tauri-apps/api');
  const core = findAlignedVersion(apiVersions, crates('tauri'));
  const build = findAlignedVersion(apiVersions, crates('tauri-build'));
  const fs = findAlignedVersion(npm('@tauri-apps/plugin-fs'), crates('tauri-plugin-fs'));
  const log = findAlignedVersion(npm('@tauri-apps/plugin-log'), crates('tauri-plugin-log'));
  const cli = npm('@tauri-apps/cli').sort(compareVersions)[0];

  return versionsFor(core, build, fs, log, cli);
}

function updatePackageJson(path: string, versions: TauriVersions) {
  console.log(`📝 Updating ${path}...`);

  const packageJsonContent = readFileSync(path, 'utf8');
  const packageJson = JSON.parse(packageJsonContent) as PackageJson;

  if (packageJson.dependencies?.['@tauri-apps/api']) {
    packageJson.dependencies['@tauri-apps/api'] = versions['npm:@tauri-apps/api'];
    console.log(`  ✓ Updated @tauri-apps/api to ${versions['npm:@tauri-apps/api']}`);
  }

  if (packageJson.dependencies?.['@tauri-apps/plugin-fs']) {
    packageJson.dependencies['@tauri-apps/plugin-fs'] = versions['npm:@tauri-apps/plugin-fs'];
    console.log(`  ✓ Updated @tauri-apps/plugin-fs to ${versions['npm:@tauri-apps/plugin-fs']}`);
  }

  if (packageJson.dependencies?.['@tauri-apps/plugin-log']) {
    packageJson.dependencies['@tauri-apps/plugin-log'] = versions['npm:@tauri-apps/plugin-log'];
    console.log(`  ✓ Updated @tauri-apps/plugin-log to ${versions['npm:@tauri-apps/plugin-log']}`);
  }

  if (packageJson.devDependencies?.['@tauri-apps/cli']) {
    packageJson.devDependencies['@tauri-apps/cli'] = versions['npm:@tauri-apps/cli'];
    console.log(`  ✓ Updated @tauri-apps/cli to ${versions['npm:@tauri-apps/cli']}`);
  }

  writeFileSync(path, `${JSON.stringify(packageJson, null, 2)}\n`);
  console.log('✅ package.json updated\n');
}

function updateCargoToml(path: string, versions: TauriVersions) {
  console.log(`📝 Updating ${path}...`);

  let cargoContent = readFileSync(path, 'utf8');

  cargoContent = cargoContent.replace(/(tauri\s*=\s*\{[^}]*version\s*=\s*")[^"]+(")/, `$1${versions['cargo:tauri']}$2`);
  console.log(`  ✓ Updated tauri dependency to ${versions['cargo:tauri']}`);

  cargoContent = cargoContent.replace(
    /(tauri-build\s*=\s*\{[^}]*version\s*=\s*")[^"]+(")/,
    `$1${versions['cargo:tauri-build']}$2`,
  );
  console.log(`  ✓ Updated tauri-build dependency to ${versions['cargo:tauri-build']}`);

  cargoContent = cargoContent.replace(/(tauri-plugin-fs\s*=\s*")[^"]+(")/, `$1${versions['cargo:tauri-plugin-fs']}$2`);
  console.log(`  ✓ Updated tauri-plugin-fs dependency to ${versions['cargo:tauri-plugin-fs']}`);

  if (cargoContent.includes('tauri-plugin-log')) {
    cargoContent = cargoContent.replace(
      /(tauri-plugin-log\s*=\s*")[^"]+(")/,
      `$1${versions['cargo:tauri-plugin-log']}$2`,
    );
    console.log(`  ✓ Updated tauri-plugin-log dependency to ${versions['cargo:tauri-plugin-log']}`);
  }

  writeFileSync(path, cargoContent);
  console.log('✅ Cargo.toml updated\n');
}

export function getMajor(version: string): number {
  return Number.parseInt(version.replace(/^[^\d]*/, ''), 10);
}

export function parseTauriMajor(cargoToml: string): number | undefined {
  const match = cargoToml.match(/^tauri\s*=\s*\{[^}]*version\s*=\s*"([^"]+)"/m);
  return match ? getMajor(match[1]) : undefined;
}

/** Returns the config with its Tauri `$schema` URL pointed at `major`, or `undefined` if it has none. */
export function rewriteTauriConfSchema(content: string, major: number): string | undefined {
  const pattern = /("\$schema"\s*:\s*"https:\/\/schema\.tauri\.app\/config\/)\d+(")/;
  return pattern.test(content) ? content.replace(pattern, `$1${major}$2`) : undefined;
}

function updateTauriConfSchema(path: string, major: number) {
  console.log(`📝 Updating ${path}...`);

  const updated = rewriteTauriConfSchema(readFileSync(path, 'utf8'), major);

  if (updated === undefined) {
    console.log(`  ⚠️  No Tauri $schema URL found; set it to https://schema.tauri.app/config/${major} manually`);
    return;
  }

  writeFileSync(path, updated);
  console.log(`  ✓ Updated $schema to config/${major}`);
  console.log('✅ tauri.conf.json updated\n');
}

function updateCargoLock(fixtureDir: string) {
  console.log(`📝 Updating ${join(fixtureDir, 'Cargo.lock')}...`);
  // Update every crate, not just Tauri's: `cargo update -p tauri ...` flips shared deps
  // (e.g. `windows-sys`) between versions on every run, while a full update is stable.
  runCommand('cargo update', fixtureDir);
  console.log('✅ Cargo.lock updated\n');
}

function runCommand(command: string, cwd?: string) {
  console.log(`📝 Running: ${command}`);
  try {
    execSync(command, { cwd, stdio: 'inherit' });
  } catch (error) {
    console.error(`❌ Command failed: ${command}`);
    throw error;
  }
}

function main() {
  const args = process.argv.slice(2);
  const specifiedVersion = args[0];

  console.log('🔧 Tauri Version Sync Script\n');

  if (specifiedVersion) {
    console.log(`Using specified version: ${specifiedVersion}\n`);
  }

  if (!specifiedVersion) {
    console.log('📦 Fetching stable versions from npm and crates.io...\n');
  }

  const versions = resolveTauriVersions(liveRegistry, specifiedVersion);

  console.log('📋 Aligned versions (highest common version):');
  console.log(`  Core (tauri):        ${versions['cargo:tauri']}`);
  console.log(`  Build (tauri-build): ${versions['cargo:tauri-build']}`);
  console.log(`  Plugin (fs):         ${versions['cargo:tauri-plugin-fs']}`);
  console.log(`  Plugin (log):       ${versions['cargo:tauri-plugin-log']}`);
  console.log(`  CLI (@tauri-apps/cli): ${versions['npm:@tauri-apps/cli']}`);
  console.log('');

  const newMajor = getMajor(versions['cargo:tauri']);
  const majorUpgrades: { fixture: string; from: number }[] = [];

  for (const fixture of FIXTURES) {
    console.log(`\n📦 Processing ${fixture.name}...`);
    const currentMajor = parseTauriMajor(readFileSync(fixture.cargoToml, 'utf8'));

    updatePackageJson(fixture.packageJson, versions);
    updateCargoToml(fixture.cargoToml, versions);

    if (currentMajor !== undefined && currentMajor !== newMajor) {
      updateTauriConfSchema(fixture.tauriConf, newMajor);
      majorUpgrades.push({ fixture: fixture.name, from: currentMajor });
    }

    updateCargoLock(dirname(fixture.packageJson));
  }

  console.log('📦 Installing dependencies...');
  for (const fixture of FIXTURES) {
    console.log(`\n🔧 Running pnpm install in ${fixture.name}...`);
    runCommand('pnpm install', dirname(fixture.packageJson));
  }

  console.log('\n🎉 Tauri versions synced successfully!');
  console.log(`\n📋 Updated fixtures:`);
  for (const fixture of FIXTURES) {
    console.log(`  - ${fixture.name}`);
  }

  if (majorUpgrades.length > 0) {
    console.log(`\n⚠️  Tauri major version changed to ${newMajor}. The $schema URLs were updated, but other`);
    console.log('   config keys, capabilities and Rust APIs may need migrating by hand. Follow the Tauri');
    console.log(`   v${newMajor} migration guide for:`);
    for (const { fixture, from } of majorUpgrades) {
      console.log(`  - ${fixture}/src-tauri/tauri.conf.json (from v${from})`);
    }
  }
}

if (import.meta.main) {
  main();
}
