#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface Fixture {
  name: string;
  packageJson: string;
  cargoToml: string;
}

const FIXTURES: Fixture[] = [
  {
    name: 'fixtures/e2e-apps/tauri',
    packageJson: join(__dirname, '..', 'fixtures', 'e2e-apps', 'tauri', 'package.json'),
    cargoToml: join(__dirname, '..', 'fixtures', 'e2e-apps', 'tauri', 'src-tauri', 'Cargo.toml'),
  },
  {
    name: 'fixtures/package-tests/tauri-app',
    packageJson: join(__dirname, '..', 'fixtures', 'package-tests', 'tauri-app', 'package.json'),
    cargoToml: join(__dirname, '..', 'fixtures', 'package-tests', 'tauri-app', 'src-tauri', 'Cargo.toml'),
  },
];

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

function getAllNpmVersions(packageName: string): string[] {
  try {
    const output = execSync(`npm view ${packageName} versions --json`, { encoding: 'utf8' });
    const versions: string[] = JSON.parse(output);
    return versions;
  } catch {
    throw new Error(`Failed to fetch versions for npm package ${packageName}`);
  }
}

function getAllCargoVersions(packageName: string): string[] {
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
  return info.versions.map((v: { num: string }) => v.num);
}

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

function findAlignedVersion(npmVersions: string[], cargoVersions: string[]): string {
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

function getLatestNpmVersion(packageName: string): string {
  const versions = getAllNpmVersions(packageName);
  return versions.sort(compareVersions)[0];
}

function updatePackageJson(path: string, versions: Record<string, string>) {
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

function updateCargoToml(path: string, versions: Record<string, string>) {
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

  console.log('📦 Fetching all versions from npm and crates.io...\n');

  const npmVersions: Record<string, string[]> = {
    '@tauri-apps/api': specifiedVersion ? [specifiedVersion] : getAllNpmVersions('@tauri-apps/api'),
    '@tauri-apps/cli': specifiedVersion ? [specifiedVersion] : getAllNpmVersions('@tauri-apps/cli'),
    '@tauri-apps/plugin-fs': specifiedVersion ? [specifiedVersion] : getAllNpmVersions('@tauri-apps/plugin-fs'),
    '@tauri-apps/plugin-log': specifiedVersion ? [specifiedVersion] : getAllNpmVersions('@tauri-apps/plugin-log'),
  };

  const cargoVersions: Record<string, string[]> = {
    tauri: specifiedVersion ? [specifiedVersion] : getAllCargoVersions('tauri'),
    'tauri-build': specifiedVersion ? [specifiedVersion] : getAllCargoVersions('tauri-build'),
    'tauri-plugin-fs': specifiedVersion ? [specifiedVersion] : getAllCargoVersions('tauri-plugin-fs'),
    'tauri-plugin-log': specifiedVersion ? [specifiedVersion] : getAllCargoVersions('tauri-plugin-log'),
  };

  console.log(
    `📋 Fetched ${npmVersions['@tauri-apps/api'].length} npm versions, ${cargoVersions.tauri.length} cargo versions\n`,
  );

  const alignedCore = specifiedVersion
    ? specifiedVersion
    : findAlignedVersion(npmVersions['@tauri-apps/api'], cargoVersions.tauri);
  const alignedBuild = specifiedVersion
    ? specifiedVersion
    : findAlignedVersion(npmVersions['@tauri-apps/api'], cargoVersions['tauri-build']);
  const alignedFs = specifiedVersion
    ? specifiedVersion
    : findAlignedVersion(npmVersions['@tauri-apps/plugin-fs'], cargoVersions['tauri-plugin-fs']);
  const alignedLog = specifiedVersion
    ? specifiedVersion
    : findAlignedVersion(npmVersions['@tauri-apps/plugin-log'], cargoVersions['tauri-plugin-log']);

  const npmCliVersion = specifiedVersion ? specifiedVersion : getLatestNpmVersion('@tauri-apps/cli');

  console.log('📋 Aligned versions (highest common version):');
  console.log(`  Core (tauri):        ${alignedCore}`);
  console.log(`  Build (tauri-build): ${alignedBuild}`);
  console.log(`  Plugin (fs):         ${alignedFs}`);
  console.log(`  Plugin (log):       ${alignedLog}`);
  console.log(`  CLI (@tauri-apps/cli): ${npmCliVersion}`);
  console.log('');

  const versions: Record<string, string> = {
    'npm:@tauri-apps/api': alignedCore,
    'npm:@tauri-apps/cli': npmCliVersion,
    'npm:@tauri-apps/plugin-fs': alignedFs,
    'npm:@tauri-apps/plugin-log': alignedLog,
    'cargo:tauri': alignedCore,
    'cargo:tauri-build': alignedBuild,
    'cargo:tauri-plugin-fs': alignedFs,
    'cargo:tauri-plugin-log': alignedLog,
  };

  for (const fixture of FIXTURES) {
    console.log(`\n📦 Processing ${fixture.name}...`);
    updatePackageJson(fixture.packageJson, versions);
    updateCargoToml(fixture.cargoToml, versions);

    const cargoLock = join(dirname(fixture.cargoToml), 'Cargo.lock');
    const pnpmLock = join(fixture.packageJson, 'pnpm-lock.yaml');

    if (existsSync(cargoLock)) {
      console.log(`  🗑️  Deleting Cargo.lock...`);
      execSync(`rm ${cargoLock}`);
    }

    if (existsSync(pnpmLock)) {
      console.log(`  🗑️  Deleting pnpm-lock.yaml...`);
      execSync(`rm ${pnpmLock}`);
    }
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
  console.log('\n⚠️  Remember to update src-tauri.conf.json files if needed!');
}

main();
