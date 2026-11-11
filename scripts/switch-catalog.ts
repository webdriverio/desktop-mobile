#!/usr/bin/env node

/**
 * Script to switch catalog dependencies for all packages in the workspace
 * Usage: node scripts/switch-catalog.ts [default|next|minimum] [--wdio-only]
 *
 * --wdio-only switches only `webdriverio` and `@wdio/*`, leaving Electron and the build tools on `default`.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'yaml';
import { type Catalogs, readCatalogs } from './strip-fixture-catalogs.ts';

export const VALID_CATALOGS = ['default', 'next', 'minimum'] as const;
export type CatalogName = (typeof VALID_CATALOGS)[number];

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
}

const isWdioPackage = (dep: string) => dep === 'webdriverio' || dep.startsWith('@wdio/');

function sortDependencies(deps: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!deps) {
    return undefined;
  }
  return Object.fromEntries(
    Object.keys(deps)
      .sort()
      .map((dep) => [dep, deps[dep]]),
  );
}

// A dep the target catalog lacks stays on `catalog:default`: `catalog:<target>` wouldn't resolve.
export function catalogRef(dep: string, target: CatalogName, catalogs: Catalogs): string {
  return catalogs[target]?.[dep] ? `catalog:${target}` : 'catalog:default';
}

export function switchDependencies(
  packageJson: PackageJson,
  target: CatalogName,
  catalogs: Catalogs,
  { wdioOnly = false } = {},
): boolean {
  const catalogDeps = Object.keys(catalogs.default ?? {})
    .filter((dep) => !wdioOnly || isWdioPackage(dep))
    .sort();
  let changed = false;

  for (const field of ['devDependencies', 'dependencies'] as const) {
    const deps = packageJson[field];
    if (!deps) {
      continue;
    }

    for (const dep of catalogDeps) {
      if (!deps[dep]) {
        continue;
      }
      if (target === 'next' && dep === 'electron') {
        delete deps[dep];
        deps['electron-nightly'] = 'catalog:next';
      } else {
        deps[dep] = catalogRef(dep, target, catalogs);
      }
      changed = true;
    }

    if (target !== 'next' && !wdioOnly && deps['electron-nightly']) {
      delete deps['electron-nightly'];
      deps.electron = catalogRef('electron', target, catalogs);
      changed = true;
    }
  }

  if (changed) {
    packageJson.dependencies = sortDependencies(packageJson.dependencies);
    packageJson.devDependencies = sortDependencies(packageJson.devDependencies);
  }
  return changed;
}

// The package tests install a fixture in isolation, where `catalog:` doesn't resolve, so they take the catalog's
// version specs for its WebdriverIO packages rather than `catalog:` refs. Returns the packages it changed.
export function pinWdioToCatalog(packageJson: PackageJson, catalog: Record<string, string>): string[] {
  const pinned: string[] = [];
  for (const field of ['dependencies', 'devDependencies'] as const) {
    const deps = packageJson[field];
    for (const dep of Object.keys(deps ?? {})) {
      if (deps && isWdioPackage(dep) && catalog[dep] && !deps[dep].startsWith('workspace:')) {
        deps[dep] = catalog[dep];
        pinned.push(dep);
      }
    }
  }
  return pinned;
}

export function specMajor(spec: string): number | undefined {
  const major = /\d+/.exec(spec)?.[0];
  return major === undefined ? undefined : Number(major);
}

interface DependencyTree {
  version?: string;
  dependencies?: Record<string, DependencyTree>;
  devDependencies?: Record<string, DependencyTree>;
  optionalDependencies?: Record<string, DependencyTree>;
}

// The versions of a package in `pnpm ls <name> --depth Infinity --json`'s output, which works with any node linker.
export function versionsInTree(projects: DependencyTree[], name: string): string[] {
  const versions = new Set<string>();
  const visit = (node: DependencyTree) => {
    for (const deps of [node.dependencies, node.devDependencies, node.optionalDependencies]) {
      for (const [dep, child] of Object.entries(deps ?? {})) {
        if (dep === name && child.version) {
          versions.add(child.version);
        }
        visit(child);
      }
    }
  };
  projects.forEach(visit);
  return [...versions];
}

// The packages that resolve to more than one version in the tree, with those versions.
export function multipleVersionsInTree(projects: DependencyTree[], names: string[]): Record<string, string[]> {
  return Object.fromEntries(
    names.map((name) => [name, versionsInTree(projects, name).sort()]).filter(([, versions]) => versions.length > 1),
  );
}

// Expands only trailing `dir/*` globs, the only kind pnpm-workspace.yaml uses.
export function listWorkspacePackages(rootDir: string): string[] {
  const workspace = yaml.parse(fs.readFileSync(path.join(rootDir, 'pnpm-workspace.yaml'), 'utf8')) as {
    packages?: string[];
  };
  const packages = new Set<string>();

  for (const entry of workspace.packages ?? []) {
    if (!entry.endsWith('/*')) {
      packages.add(entry);
      continue;
    }
    const parent = entry.slice(0, -2);
    const parentAbs = path.join(rootDir, parent);
    if (!fs.existsSync(parentAbs)) {
      continue;
    }
    for (const dirent of fs.readdirSync(parentAbs, { withFileTypes: true })) {
      if (dirent.isDirectory()) {
        packages.add(`${parent}/${dirent.name}`);
      }
    }
  }

  return [...packages].sort();
}

export function switchCatalog(rootDir: string, target: CatalogName, { wdioOnly = false } = {}): string[] {
  const catalogs = readCatalogs(rootDir);
  const updated: string[] = [];

  for (const packagePath of listWorkspacePackages(rootDir)) {
    // Fixtures are also installed in isolation, where `catalog:` doesn't resolve, so they keep explicit versions.
    if (packagePath.startsWith('fixtures/')) {
      console.log(`- Skipping ${packagePath} (fixture package)`);
      continue;
    }

    const packageJsonPath = path.join(rootDir, packagePath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      if (!fs.existsSync(path.join(rootDir, packagePath, 'Cargo.toml'))) {
        console.warn(`Warning: No package.json found in ${packagePath}`);
      }
      continue;
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as PackageJson;
    if (switchDependencies(packageJson, target, catalogs, { wdioOnly })) {
      fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
      updated.push(packagePath);
      console.log(`✓ Updated ${packagePath} to use catalog:${target}`);
    } else {
      console.log(`- No changes needed for ${packagePath}`);
    }
  }

  return updated;
}

function main(): void {
  const args = process.argv.slice(2);
  const wdioOnly = args.includes('--wdio-only');
  const target = args.find((arg) => !arg.startsWith('--'))?.toLowerCase() as CatalogName | undefined;

  if (!target || !VALID_CATALOGS.includes(target)) {
    console.error(`Error: Please specify a valid catalog: ${VALID_CATALOGS.join(', ')}`);
    process.exit(1);
  }

  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  try {
    console.log(`Switching ${wdioOnly ? 'WebdriverIO packages' : 'all packages'} to the '${target}' catalog...\n`);
    switchCatalog(rootDir, target, { wdioOnly });

    console.log('\nRunning pnpm install to apply the changes...');
    execSync('pnpm install --no-frozen-lockfile', { cwd: rootDir, stdio: 'inherit' });
    console.log('\n✓ Successfully switched catalog and installed dependencies');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

if (import.meta.main) {
  main();
}
