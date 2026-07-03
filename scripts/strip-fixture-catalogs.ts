#!/usr/bin/env node

// `pnpm up --latest` (run by `update:dependencies`) rewrites any exact-pinned dep that has a
// matching catalog entry into a `catalog:` reference. That's fine for workspace packages, but the
// package-test fixtures under fixtures/package-tests/* are also installed in isolation (outside the
// workspace), where the `catalog:` protocol does not resolve — they MUST carry explicit versions.
// This strips catalog: refs back out of those fixtures, resolving each to its catalog version.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as yaml from 'yaml';

const PACKAGE_TESTS_DIR = 'fixtures/package-tests';
const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

export type Catalogs = Record<string, Record<string, string>>;

export interface CatalogRef {
  file: string;
  field: string;
  dep: string;
  spec: string;
}

export function readCatalogs(repoRoot: string): Catalogs {
  const parsed = yaml.parse(fs.readFileSync(path.join(repoRoot, 'pnpm-workspace.yaml'), 'utf8')) as {
    catalog?: Record<string, string>;
    catalogs?: Catalogs;
  };
  const catalogs: Catalogs = { ...(parsed.catalogs ?? {}) };
  // pnpm's top-level `catalog:` is the default catalog; named catalogs live under `catalogs:`.
  if (parsed.catalog) {
    catalogs.default = { ...parsed.catalog, ...(catalogs.default ?? {}) };
  }
  return catalogs;
}

export function listFixturePackageJsons(repoRoot: string): string[] {
  const dir = path.join(repoRoot, PACKAGE_TESTS_DIR);
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(dir, entry.name, 'package.json'))
    .filter((file) => fs.existsSync(file));
}

/** Resolve a `catalog:` / `catalog:<name>` spec to its concrete version from the catalogs. */
export function resolveCatalogSpec(dep: string, spec: string, catalogs: Catalogs): string {
  const name = spec.slice('catalog:'.length) || 'default';
  const version = catalogs[name]?.[dep];
  if (!version) {
    throw new Error(`No entry for "${dep}" in catalog "${name}" (spec "${spec}") — cannot de-catalog.`);
  }
  return version;
}

/** Find every catalog: reference across the package-test fixtures (read-only — used by the guard test). */
export function findCatalogRefs(repoRoot: string): CatalogRef[] {
  const refs: CatalogRef[] = [];
  for (const file of listFixturePackageJsons(repoRoot)) {
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const field of DEP_FIELDS) {
      const deps = pkg[field] as Record<string, string> | undefined;
      if (!deps) {
        continue;
      }
      for (const [dep, spec] of Object.entries(deps)) {
        if (typeof spec === 'string' && spec.startsWith('catalog:')) {
          refs.push({ file, field, dep, spec });
        }
      }
    }
  }
  return refs;
}

/** Rewrite catalog: refs to explicit versions in-place. Returns the files that changed. */
export function stripFixtureCatalogs(repoRoot: string): string[] {
  const catalogs = readCatalogs(repoRoot);
  const changed: string[] = [];

  for (const file of listFixturePackageJsons(repoRoot)) {
    const original = fs.readFileSync(file, 'utf8');
    const pkg = JSON.parse(original);
    let text = original;

    for (const field of DEP_FIELDS) {
      const deps = pkg[field] as Record<string, string> | undefined;
      if (!deps) {
        continue;
      }
      for (const [dep, spec] of Object.entries(deps)) {
        if (typeof spec !== 'string' || !spec.startsWith('catalog:')) {
          continue;
        }
        const version = resolveCatalogSpec(dep, spec, catalogs);
        // Surgical string replace so formatting and key order are preserved exactly.
        text = text.split(`"${dep}": "${spec}"`).join(`"${dep}": "${version}"`);
      }
    }

    if (text !== original) {
      fs.writeFileSync(file, text);
      changed.push(file);
    }
  }

  return changed;
}

function main(): void {
  const repoRoot = process.cwd();
  const changed = stripFixtureCatalogs(repoRoot);

  if (changed.length === 0) {
    console.log('No catalog: refs in package-test fixtures — nothing to strip.');
    return;
  }

  console.log(`Stripped catalog: refs from ${changed.length} fixture package.json file(s):`);
  for (const file of changed) {
    console.log(`  - ${path.relative(repoRoot, file)}`);
  }

  console.log('Resyncing lockfile (pnpm install --lockfile-only)…');
  execFileSync('pnpm', ['install', '--lockfile-only'], { stdio: 'inherit' });
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
