#!/usr/bin/env node
/**
 * Keeps tauri-plugin-wdio-webdriver's Windows bindings (webview2-com, windows, windows-core) on the
 * releases the latest Tauri 2 uses, so apps don't compile two copies. Dependabot won't move them: a
 * 0.x minor counts as a major, which our cargo config ignores.
 *
 * Usage: node scripts/sync-tauri-webview2-bindings.ts [--write]
 *   default  report whether the bindings have drifted from Tauri's
 *   --write  also update the plugin's Cargo.toml and re-lock every lockfile that builds it
 *
 * Under GitHub Actions it writes `drift`, `tauri`, `webview2_com`, `from` and `to` to $GITHUB_OUTPUT.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
export const PLUGIN_DIR = 'packages/tauri-plugin-webdriver';

/** Workspaces whose Cargo.lock builds the plugin. */
export const LOCKED_WORKSPACES = [PLUGIN_DIR, 'fixtures/e2e-apps/tauri', 'fixtures/package-tests/tauri-app'];

export const BINDING_CRATES = ['webview2-com', 'windows', 'windows-core'] as const;
export type BindingCrate = (typeof BINDING_CRATES)[number];
export type Bindings = Record<BindingCrate, string>;

const WINDOWS_DEPS_HEADER = '[target."cfg(target_os = \\"windows\\")".dependencies]';
const WINDOWS_CRATE_HEADER = '[target."cfg(target_os = \\"windows\\")".dependencies.windows]';

interface CargoMetadata {
  packages: Array<{ id: string; name: string; version: string }>;
  resolve: { nodes: Array<{ id: string; deps: Array<{ pkg: string }> }> };
}

/** `0.39.1` → `0.39` */
export function requirementFor(version: string): string {
  const [major, minor] = version.split('.');
  return `${major}.${minor}`;
}

/** The bindings Tauri's wry resolved to, plus the Tauri version. */
export function tauriBindings(metadata: CargoMetadata): { tauri: string; versions: Bindings } {
  const packages = new Map(metadata.packages.map((pkg) => [pkg.id, pkg]));
  const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const findByName = (name: string) => metadata.packages.filter((pkg) => pkg.name === name);
  const depOf = (nodeId: string, name: string) => {
    const dep = nodes
      .get(nodeId)
      ?.deps.map((d) => packages.get(d.pkg))
      .find((pkg) => pkg?.name === name);
    if (!dep) {
      throw new Error(`${packages.get(nodeId)?.name} has no ${name} dependency in the resolved graph`);
    }
    return dep;
  };

  const tauri = findByName('tauri');
  const wry = findByName('wry');
  if (tauri.length !== 1 || wry.length !== 1) {
    throw new Error(
      `expected exactly one tauri and one wry in the resolved graph, found ${tauri.length} and ${wry.length}`,
    );
  }
  const webview2Com = depOf(wry[0].id, 'webview2-com');
  return {
    tauri: tauri[0].version,
    versions: {
      'webview2-com': webview2Com.version,
      windows: depOf(webview2Com.id, 'windows').version,
      'windows-core': depOf(webview2Com.id, 'windows-core').version,
    },
  };
}

function locateRequirements(manifest: string): Record<BindingCrate, { line: number; requirement: string }> {
  const lines = manifest.split('\n');
  const found: Partial<Record<BindingCrate, { line: number; requirement: string }>> = {};
  let section = '';
  lines.forEach((raw, line) => {
    const text = raw.trim();
    if (text.startsWith('[')) {
      section = text;
      return;
    }
    const entry = /^([\w-]+)\s*=\s*"([^"]*)"$/.exec(text);
    if (!entry) {
      return;
    }
    const [, key, requirement] = entry;
    if (section === WINDOWS_DEPS_HEADER && (key === 'webview2-com' || key === 'windows-core')) {
      found[key] = { line, requirement };
    } else if (section === WINDOWS_CRATE_HEADER && key === 'version') {
      found.windows = { line, requirement };
    }
  });
  const missing = BINDING_CRATES.filter((crate) => !found[crate]);
  if (missing.length > 0) {
    throw new Error(
      `could not find the ${missing.join(', ')} requirement(s) in ${PLUGIN_DIR}/Cargo.toml. ` +
        'Its layout changed; update the section headers in scripts/sync-tauri-webview2-bindings.ts.',
    );
  }
  return found as Record<BindingCrate, { line: number; requirement: string }>;
}

export function readRequirements(manifest: string): Bindings {
  const located = locateRequirements(manifest);
  return Object.fromEntries(BINDING_CRATES.map((crate) => [crate, located[crate].requirement])) as Bindings;
}

/** Rewrites just the requirement strings, leaving the rest of the manifest untouched. */
export function writeRequirements(manifest: string, next: Bindings): string {
  const located = locateRequirements(manifest);
  const lines = manifest.split('\n');
  for (const crate of BINDING_CRATES) {
    const { line, requirement } = located[crate];
    lines[line] = lines[line].replace(`"${requirement}"`, `"${next[crate]}"`);
  }
  return lines.join('\n');
}

function cargo(args: string[], cwd: string): string {
  return execFileSync('cargo', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

/** Resolves the plugin without its Cargo.lock, as a new consumer would. */
function resolveAsConsumer(): CargoMetadata {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tauri-bindings-'));
  try {
    const skip = new Set(['target', 'node_modules', 'Cargo.lock']);
    fs.cpSync(path.join(REPO_ROOT, PLUGIN_DIR), scratch, {
      recursive: true,
      filter: (src) => !skip.has(path.basename(src)),
    });
    return JSON.parse(
      cargo(['metadata', '--format-version', '1', '--filter-platform', 'x86_64-pc-windows-msvc'], scratch),
    ) as CargoMetadata;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function appendFile(envVar: string, content: string) {
  const file = process.env[envVar];
  if (file) {
    fs.appendFileSync(file, content);
  }
}

function main() {
  const write = process.argv.includes('--write');
  const manifestPath = path.join(REPO_ROOT, PLUGIN_DIR, 'Cargo.toml');
  const manifest = fs.readFileSync(manifestPath, 'utf8');

  const current = readRequirements(manifest);
  const { tauri, versions } = tauriBindings(resolveAsConsumer());
  const target = Object.fromEntries(
    BINDING_CRATES.map((crate) => [crate, requirementFor(versions[crate])]),
  ) as Bindings;
  const drifted = BINDING_CRATES.filter((crate) => current[crate] !== target[crate]);
  const describe = (bindings: Bindings) => BINDING_CRATES.map((crate) => `${crate} ${bindings[crate]}`).join(', ');

  appendFile(
    'GITHUB_OUTPUT',
    `drift=${drifted.length > 0}\ntauri=${tauri}\nwebview2_com=${target['webview2-com']}\n` +
      `from=${describe(current)}\nto=${describe(target)}\n`,
  );

  if (drifted.length === 0) {
    console.log(`In sync with Tauri ${tauri}: ${describe(current)}`);
    return;
  }
  console.log(`Tauri ${tauri} uses ${describe(target)}; the plugin declares ${describe(current)}.`);
  if (!write) {
    console.log('Run with --write to align the plugin.');
    return;
  }

  fs.writeFileSync(manifestPath, writeRequirements(manifest, target));
  for (const workspace of LOCKED_WORKSPACES) {
    // Only moves the locked versions the new requirements force.
    cargo(['update', '--workspace'], path.join(REPO_ROOT, workspace));
  }
  console.log(`Updated ${PLUGIN_DIR}/Cargo.toml and re-locked ${LOCKED_WORKSPACES.join(', ')}.`);
}

if (import.meta.main) {
  main();
}
