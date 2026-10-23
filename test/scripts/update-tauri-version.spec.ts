import { describe, expect, it, vi } from 'vitest';
import {
  type CrateVersion,
  parseTauriMajor,
  type Registry,
  resolveTauriVersions,
  rewriteTauriConfSchema,
  stableCrateVersions,
  stableNpmVersions,
} from '../../scripts/update-tauri-version.ts';

const crate = (num: string, yanked = false): CrateVersion => ({ num, yanked });

const NPM: Record<string, string[]> = {
  '@tauri-apps/api': ['2.7.0', '2.11.0', '2.12.0', '2.12.1', '2.13.0-beta.1', '3.0.0-alpha.0'],
  '@tauri-apps/cli': ['2.9.0', '2.12.1', '3.0.0-alpha.0'],
  '@tauri-apps/plugin-fs': ['2.6.0', '2.7.1', '3.0.0-alpha.0'],
  '@tauri-apps/plugin-log': ['2.10.0', '2.10.1', '3.0.0-alpha.0'],
};

const CRATES: Record<string, CrateVersion[]> = {
  tauri: [crate('2.11.0'), crate('2.12.0'), crate('2.12.1', true), crate('3.0.0-alpha.0')],
  'tauri-build': [crate('2.6.0'), crate('2.7.0'), crate('3.0.0-alpha.0')],
  'tauri-plugin-fs': [crate('2.6.0'), crate('2.7.1'), crate('3.0.0-alpha.0')],
  'tauri-plugin-log': [crate('2.10.0'), crate('2.10.1'), crate('3.0.0-alpha.0')],
};

function fakeRegistry(): Registry {
  return {
    npmVersions: vi.fn((name: string) => NPM[name]),
    crateVersions: vi.fn((name: string) => CRATES[name]),
  };
}

describe('stableNpmVersions', () => {
  it('should drop prereleases', () => {
    expect(stableNpmVersions(['2.12.1', '2.13.0-beta.1', '3.0.0-alpha.0'])).toEqual(['2.12.1']);
  });
});

describe('stableCrateVersions', () => {
  it('should drop prereleases and yanked versions', () => {
    expect(stableCrateVersions([crate('2.12.0'), crate('2.12.1', true), crate('3.0.0-alpha.0')])).toEqual(['2.12.0']);
  });
});

describe('resolveTauriVersions', () => {
  it('should pick the newest stable version published on both registries', () => {
    expect(resolveTauriVersions(fakeRegistry())).toEqual({
      'npm:@tauri-apps/api': '2.12.0',
      'npm:@tauri-apps/cli': '2.12.1',
      'npm:@tauri-apps/plugin-fs': '2.7.1',
      'npm:@tauri-apps/plugin-log': '2.10.1',
      'cargo:tauri': '2.12.0',
      'cargo:tauri-build': '2.7.0',
      'cargo:tauri-plugin-fs': '2.7.1',
      'cargo:tauri-plugin-log': '2.10.1',
    });
  });

  it('should throw when the only common versions are prereleases', () => {
    const registry: Registry = {
      npmVersions: () => ['3.0.0-alpha.0'],
      crateVersions: () => [crate('3.0.0-alpha.0')],
    };
    expect(() => resolveTauriVersions(registry)).toThrow(/No common version found/);
  });

  it('should pin every package to an explicit version without querying the registries', () => {
    const registry = fakeRegistry();
    const versions = resolveTauriVersions(registry, '3.0.0-alpha.0');

    expect(new Set(Object.values(versions))).toEqual(new Set(['3.0.0-alpha.0']));
    expect(registry.npmVersions).not.toHaveBeenCalled();
    expect(registry.crateVersions).not.toHaveBeenCalled();
  });
});

describe('parseTauriMajor', () => {
  const cargoToml = (tauriVersion: string) => `[build-dependencies]
tauri-build = { version = "9.9.9", features = [] }

[dependencies]
tauri = { version = "${tauriVersion}", features = ["tray-icon"] }
tauri-plugin-fs = "9.9.9"
`;

  it('should read the major version of the tauri dependency, not tauri-build', () => {
    expect(parseTauriMajor(cargoToml('2.12.4'))).toBe(2);
    expect(parseTauriMajor(cargoToml('3.0.0'))).toBe(3);
  });

  it('should return undefined when there is no tauri dependency', () => {
    expect(parseTauriMajor('[dependencies]\nserde = "1"\n')).toBeUndefined();
  });
});

describe('rewriteTauriConfSchema', () => {
  it('should point the $schema URL at the new major version', () => {
    const conf = '{\n  "$schema": "https://schema.tauri.app/config/2",\n  "version": "0.1.0"\n}\n';
    expect(rewriteTauriConfSchema(conf, 3)).toBe(
      '{\n  "$schema": "https://schema.tauri.app/config/3",\n  "version": "0.1.0"\n}\n',
    );
  });

  it('should return undefined when the config has no Tauri $schema URL', () => {
    expect(rewriteTauriConfSchema('{\n  "version": "0.1.0"\n}\n', 3)).toBeUndefined();
  });
});
