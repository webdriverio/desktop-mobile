import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type Bindings,
  LOCKED_WORKSPACES,
  PLUGIN_DIR,
  readRequirements,
  requirementFor,
  tauriBindings,
  writeRequirements,
} from '../../scripts/sync-tauri-webview2-bindings.ts';

const REPO_ROOT = new URL('../../', import.meta.url);
const manifest = readFileSync(new URL(`${PLUGIN_DIR}/Cargo.toml`, REPO_ROOT), 'utf8');

/** A resolved `cargo metadata` graph from `name@version` edges. */
function graph(edges: Record<string, string[]>) {
  const ids = [...new Set([...Object.keys(edges), ...Object.values(edges).flat()])];
  return {
    packages: ids.map((id) => {
      const [name, version] = id.split('@');
      return { id, name, version };
    }),
    resolve: { nodes: ids.map((id) => ({ id, deps: (edges[id] ?? []).map((pkg) => ({ pkg })) })) },
  };
}

// The plugin still on older bindings than Tauri: both copies are in the graph.
const DRIFTED = {
  'tauri-plugin-wdio-webdriver@1.4.0': ['tauri@2.12.0', 'webview2-com@0.38.2', 'windows@0.61.3'],
  'tauri@2.12.0': ['tauri-runtime-wry@2.12.0'],
  'tauri-runtime-wry@2.12.0': ['wry@0.57.0'],
  'wry@0.57.0': ['webview2-com@0.39.1', 'windows@0.62.2'],
  'webview2-com@0.39.1': ['windows@0.62.2', 'windows-core@0.62.2'],
  'webview2-com@0.38.2': ['windows@0.61.3', 'windows-core@0.61.2'],
};

describe('requirementFor', () => {
  it('should keep the release line of a 0.x version', () => {
    expect(requirementFor('0.39.1')).toBe('0.39');
  });

  it('should keep major.minor of a 1.x+ version', () => {
    expect(requirementFor('1.4.0')).toBe('1.4');
  });
});

describe('tauriBindings', () => {
  it("should read wry's webview2-com and that release's windows crates, not the plugin's copy", () => {
    expect(tauriBindings(graph(DRIFTED))).toEqual({
      tauri: '2.12.0',
      versions: { 'webview2-com': '0.39.1', windows: '0.62.2', 'windows-core': '0.62.2' },
    });
  });

  it('should throw when Tauri no longer resolves wry', () => {
    const { 'wry@0.57.0': _, ...edges } = DRIFTED;
    expect(() => tauriBindings(graph({ ...edges, 'tauri-runtime-wry@2.12.0': [] }))).toThrow(/one tauri and one wry/);
  });

  it('should throw when wry has no webview2-com dependency', () => {
    expect(() => tauriBindings(graph({ ...DRIFTED, 'wry@0.57.0': ['windows@0.62.2'] }))).toThrow(
      /wry has no webview2-com dependency/,
    );
  });
});

describe('plugin manifest requirements', () => {
  it("should find all three binding requirements in the plugin's Cargo.toml", () => {
    const requirements = readRequirements(manifest);
    for (const requirement of Object.values(requirements)) expect(requirement).toMatch(/^\d+\.\d+$/);
  });

  it('should rewrite only the three requirement strings', () => {
    const next: Bindings = { 'webview2-com': '0.99', windows: '0.98', 'windows-core': '0.97' };
    const rewritten = writeRequirements(manifest, next);

    expect(readRequirements(rewritten)).toEqual(next);
    const before = manifest.split('\n');
    const changed = rewritten.split('\n').filter((line, i) => line !== before[i]);
    expect(changed).toEqual(['webview2-com = "0.99"', 'windows-core = "0.97"', 'version = "0.98"']);
  });

  it('should throw when a requirement is missing, rather than rewrite the wrong line', () => {
    const withoutWindowsCrate = manifest.replace(
      /\[target\."cfg\(target_os = \\"windows\\"\)"\.dependencies\.windows\]/,
      '',
    );
    expect(() => readRequirements(withoutWindowsCrate)).toThrow(/could not find the windows requirement/);
  });
});

describe('LOCKED_WORKSPACES', () => {
  it('should list every committed Cargo.lock that builds the plugin', () => {
    const lockfiles = execFileSync('git', ['ls-files', '*Cargo.lock'], { cwd: REPO_ROOT, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    const building = lockfiles
      .filter((file) => readFileSync(new URL(file, REPO_ROOT), 'utf8').includes('name = "tauri-plugin-wdio-webdriver"'))
      .map((file) => file.replace(/\/Cargo\.lock$/, ''));

    expect(building.sort()).toEqual([...LOCKED_WORKSPACES].sort());
  });
});
