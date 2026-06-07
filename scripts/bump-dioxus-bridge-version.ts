#!/usr/bin/env node
/**
 * Keep @wdio/dioxus-bridge (npm) and the dependent Cargo crates in lockstep.
 *
 * Source of truth: packages/dioxus-bridge/package.json `version`.
 *
 * Targets (core X.Y.Z synced; each target's pre-release suffix preserved):
 *   - packages/dioxus-bridge/Cargo.toml          [package].version
 *   - packages/dioxus-embedded-driver/Cargo.toml [package].version
 *   - packages/dioxus-embedded-driver/Cargo.toml wdio-dioxus-bridge path-dep `version`
 *
 * npm uses `-next.N` suffixes, crates.io uses `-rc.N` — that's a deliberate
 * per-registry convention and build.rs only enforces core agreement, so this
 * script does the same.
 *
 * Usage:
 *   node scripts/bump-dioxus-bridge-version.ts
 *     → read npm version, sync all crate targets to its core
 *
 *   node scripts/bump-dioxus-bridge-version.ts 1.0.0-next.1
 *     → write 1.0.0-next.1 verbatim to package.json, then sync as above
 *
 *   node scripts/bump-dioxus-bridge-version.ts --check
 *     → exit 1 if any target is out of sync; print what would change
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = join(dirname(__filename), '..');

const NPM_PACKAGE_JSON = join(REPO_ROOT, 'packages/dioxus-bridge/package.json');
const BRIDGE_CARGO_TOML = join(REPO_ROOT, 'packages/dioxus-bridge/Cargo.toml');
const EMBEDDED_DRIVER_CARGO_TOML = join(REPO_ROOT, 'packages/dioxus-embedded-driver/Cargo.toml');

interface PendingEdit {
  label: string;
  path: string;
  before: string;
  after: string;
  /** Transform applied to the file's current contents (so multiple edits to
   * the same file compose correctly). */
  transform: (current: string) => string;
}

/** Return the core `X.Y.Z` from a SemVer string, dropping any pre-release suffix. */
function coreVersion(v: string): string {
  return v.split('-', 1)[0];
}

/** Apply a new core version to a SemVer string, preserving any existing pre-release suffix. */
function withCore(version: string, newCore: string): string {
  const dashIdx = version.indexOf('-');
  return dashIdx === -1 ? newCore : `${newCore}${version.slice(dashIdx)}`;
}

function readNpmVersion(): string {
  const pkg = JSON.parse(readFileSync(NPM_PACKAGE_JSON, 'utf8')) as { version?: string };
  if (!pkg.version) {
    throw new Error(`Missing \`version\` field in ${NPM_PACKAGE_JSON}`);
  }
  return pkg.version;
}

function writeNpmVersion(newVersion: string): PendingEdit | undefined {
  const content = readFileSync(NPM_PACKAGE_JSON, 'utf8');
  const pkg = JSON.parse(content) as { version?: string };
  if (!pkg.version) {
    throw new Error(`Missing \`version\` field in ${NPM_PACKAGE_JSON}`);
  }
  const before = pkg.version;
  if (before === newVersion) return undefined;
  return {
    label: 'package.json [version]',
    path: NPM_PACKAGE_JSON,
    before,
    after: newVersion,
    transform: (current: string) => {
      const obj = JSON.parse(current) as { version?: string; [key: string]: unknown };
      obj.version = newVersion;
      // Preserve trailing newline (JSON.stringify drops it; prettier-style files keep it)
      return `${JSON.stringify(obj, null, 2)}\n`;
    },
  };
}

/** Replace `[package]`'s top-level `version = "..."` in a Cargo.toml. */
function syncPackageVersion(cargoPath: string, newCore: string): PendingEdit | undefined {
  const content = readFileSync(cargoPath, 'utf8');
  // Match the FIRST `version = "..."` after `[package]` — Cargo.toml convention
  // is that [package] is the leading table, so a non-greedy match from there is
  // safe and avoids touching dependency `version` fields below.
  const re = /(\[package\][\s\S]*?\nversion\s*=\s*")([^"]+)(")/;
  const match = content.match(re);
  if (!match) {
    throw new Error(`Could not find [package] version in ${cargoPath}`);
  }
  const before = match[2];
  const after = withCore(before, newCore);
  if (before === after) return undefined;
  return {
    label: `${cargoPath.replace(`${REPO_ROOT}/`, '')} [package].version`,
    path: cargoPath,
    before,
    after,
    transform: (current: string) => current.replace(re, `$1${after}$3`),
  };
}

/** Replace the `wdio-dioxus-bridge = { path = ..., version = "..." }` path-dep version. */
function syncPathDepVersion(cargoPath: string, newCore: string): PendingEdit | undefined {
  const content = readFileSync(cargoPath, 'utf8');
  const re = /(wdio-dioxus-bridge\s*=\s*\{[^}]*\bversion\s*=\s*")([^"]+)(")/;
  const match = content.match(re);
  if (!match) {
    throw new Error(`Could not find wdio-dioxus-bridge path-dep version in ${cargoPath}`);
  }
  const before = match[2];
  const after = withCore(before, newCore);
  if (before === after) return undefined;
  return {
    label: `${cargoPath.replace(`${REPO_ROOT}/`, '')} wdio-dioxus-bridge path-dep`,
    path: cargoPath,
    before,
    after,
    transform: (current: string) => current.replace(re, `$1${after}$3`),
  };
}

function main(): void {
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  const positional = args.find((a) => !a.startsWith('--'));

  const edits: PendingEdit[] = [];

  if (positional) {
    if (checkOnly) {
      console.error('❌ --check cannot be combined with an explicit version arg');
      process.exit(2);
    }
    const npmEdit = writeNpmVersion(positional);
    if (npmEdit) edits.push(npmEdit);
  }

  const npmVersion = positional ?? readNpmVersion();
  const newCore = coreVersion(npmVersion);
  console.log(`🔧 Source: ${NPM_PACKAGE_JSON.replace(`${REPO_ROOT}/`, '')} @ ${npmVersion} (core ${newCore})`);

  for (const sync of [
    () => syncPackageVersion(BRIDGE_CARGO_TOML, newCore),
    () => syncPackageVersion(EMBEDDED_DRIVER_CARGO_TOML, newCore),
    () => syncPathDepVersion(EMBEDDED_DRIVER_CARGO_TOML, newCore),
  ]) {
    const edit = sync();
    if (edit) edits.push(edit);
  }

  if (edits.length === 0) {
    console.log('✅ All targets already in sync.');
    return;
  }

  console.log(`\n📋 ${checkOnly ? 'Would update' : 'Updating'} ${edits.length} target(s):`);
  for (const edit of edits) {
    console.log(`  - ${edit.label}: ${edit.before} → ${edit.after}`);
  }

  if (checkOnly) {
    console.error('\n❌ Versions out of sync. Run `node scripts/bump-dioxus-bridge-version.ts` to fix.');
    process.exit(1);
  }

  // Group edits by file and apply transforms in order, so multiple edits to
  // the same file compose. Without this, each transform would race on its own
  // read of the original file and the last write would clobber earlier edits.
  const byPath = new Map<string, PendingEdit[]>();
  for (const edit of edits) {
    const existing = byPath.get(edit.path);
    if (existing) existing.push(edit);
    else byPath.set(edit.path, [edit]);
  }
  for (const [path, fileEdits] of byPath) {
    let content = readFileSync(path, 'utf8');
    for (const edit of fileEdits) {
      content = edit.transform(content);
    }
    writeFileSync(path, content);
  }
  console.log('\n✅ Done. Review the diff and commit.');
}

main();
