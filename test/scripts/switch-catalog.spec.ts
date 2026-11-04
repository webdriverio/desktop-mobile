import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readCatalogs } from '../../scripts/strip-fixture-catalogs.ts';
import {
  installedVersions,
  pinWdioToCatalog,
  specMajor,
  switchCatalog,
  switchDependencies,
} from '../../scripts/switch-catalog.ts';

const REPO_ROOT = new URL('../..', import.meta.url).pathname;

const CATALOGS = {
  default: {
    '@wdio/display-server': '10.1.0',
    '@wdio/types': '10.1.0',
    electron: '45.0.0',
    webdriverio: '10.1.0',
  },
  minimum: {
    '@wdio/types': '^9.0.0',
    electron: '28.3.3',
    webdriverio: '^9.0.0',
  },
  next: {
    '@wdio/types': 'latest',
    'electron-nightly': '47.0.0-nightly.20261023',
    webdriverio: 'latest',
  },
};

function servicePackageJson() {
  return {
    name: 'svc',
    dependencies: { webdriverio: 'catalog:default', yaml: '^2.9.1' },
    devDependencies: {
      '@wdio/display-server': 'catalog:default',
      '@wdio/types': 'catalog:default',
      electron: 'catalog:default',
    },
    peerDependencies: { webdriverio: '^9.0.0 || ^10.0.0' },
  };
}

describe('switchDependencies', () => {
  it('should move only the WebdriverIO packages with wdioOnly', () => {
    const pkg = servicePackageJson();

    expect(switchDependencies(pkg, 'minimum', CATALOGS, { wdioOnly: true })).toBe(true);
    expect(pkg.dependencies).toEqual({ webdriverio: 'catalog:minimum', yaml: '^2.9.1' });
    expect(pkg.devDependencies).toMatchObject({ '@wdio/types': 'catalog:minimum', electron: 'catalog:default' });
  });

  it('should keep a package the target catalog lacks on the default catalog', () => {
    const pkg = servicePackageJson();

    switchDependencies(pkg, 'minimum', CATALOGS, { wdioOnly: true });

    expect(pkg.devDependencies['@wdio/display-server']).toBe('catalog:default');
  });

  it('should leave peer dependencies alone', () => {
    const pkg = servicePackageJson();

    switchDependencies(pkg, 'minimum', CATALOGS);

    expect(pkg.peerDependencies).toEqual({ webdriverio: '^9.0.0 || ^10.0.0' });
  });

  it('should swap electron for electron-nightly on next, and back', () => {
    const pkg = servicePackageJson();

    switchDependencies(pkg, 'next', CATALOGS);
    expect(pkg.devDependencies).toMatchObject({ 'electron-nightly': 'catalog:next' });
    expect(pkg.devDependencies).not.toHaveProperty('electron');

    switchDependencies(pkg, 'default', CATALOGS);
    expect(pkg.devDependencies).toMatchObject({ electron: 'catalog:default' });
    expect(pkg.devDependencies).not.toHaveProperty('electron-nightly');
  });

  it('should restore the original package.json when switched back to default', () => {
    const pkg = servicePackageJson();
    const original = JSON.stringify(pkg);

    switchDependencies(pkg, 'minimum', CATALOGS);
    switchDependencies(pkg, 'default', CATALOGS);

    expect(JSON.stringify(pkg)).toBe(original);
  });

  it('should report no change for a package without catalog dependencies', () => {
    expect(switchDependencies({ dependencies: { yaml: '^2.9.1' } }, 'minimum', CATALOGS)).toBe(false);
  });
});

describe('pinWdioToCatalog', () => {
  function fixturePackageJson() {
    return {
      dependencies: { yaml: '^2.9.1' },
      devDependencies: {
        '@wdio/cli': '^10.1.0',
        '@wdio/display-server': '^10.1.0',
        '@wdio/tauri-service': 'workspace:*',
        '@wdio/types': '^10.1.0',
        electron: '45.0.0',
      },
    };
  }

  it("should pin the fixture's WebdriverIO packages to the catalog's specs", () => {
    const packageJson = fixturePackageJson();

    const pinned = pinWdioToCatalog(packageJson, { '@wdio/cli': '^9.0.0', '@wdio/types': '^9.0.0' });

    expect(pinned).toEqual(['@wdio/cli', '@wdio/types']);
    expect(packageJson.devDependencies).toMatchObject({ '@wdio/cli': '^9.0.0', '@wdio/types': '^9.0.0' });
  });

  it('should leave packages the catalog lacks, workspace packages and other dependencies alone', () => {
    const packageJson = fixturePackageJson();

    pinWdioToCatalog(packageJson, {
      '@wdio/tauri-service': '^1.0.0',
      electron: '28.3.3',
      webdriverio: '^9.0.0',
      yaml: '^1.0.0',
    });

    expect(packageJson).toEqual(fixturePackageJson());
  });
});

describe('specMajor', () => {
  it.each([
    ['^9.33.0', 9],
    ['~10.2.0', 10],
    ['9.33.1', 9],
    ['10.2.0-alpha.1', 10],
  ])('should read the major from %s', (spec, major) => {
    expect(specMajor(spec)).toBe(major);
  });

  it('should return undefined for a spec without a version', () => {
    expect(specMajor('latest')).toBeUndefined();
  });
});

describe('installedVersions', () => {
  let nodeModulesDir: string;

  beforeEach(() => {
    nodeModulesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'installed-versions-'));
    for (const entry of [
      'webdriverio@9.33.1_bufferutil@4.1.0',
      'webdriverio@10.1.0',
      'webdriverio-extra@1.0.0',
      '@wdio+cli@9.33.1',
      'node_modules',
    ]) {
      fs.mkdirSync(path.join(nodeModulesDir, '.pnpm', entry), { recursive: true });
    }
  });

  afterEach(() => {
    fs.rmSync(nodeModulesDir, { recursive: true, force: true });
  });

  it("should list each version of the package in pnpm's virtual store", () => {
    expect(installedVersions(nodeModulesDir, 'webdriverio').sort()).toEqual(['10.1.0', '9.33.1']);
  });

  it('should find a scoped package', () => {
    expect(installedVersions(nodeModulesDir, '@wdio/cli')).toEqual(['9.33.1']);
  });

  it('should return nothing without a virtual store', () => {
    expect(installedVersions(path.join(nodeModulesDir, 'missing'), 'webdriverio')).toEqual([]);
  });
});

describe('switchCatalog', () => {
  let rootDir: string;

  const writeJson = (relativePath: string, value: unknown) => {
    const file = path.join(rootDir, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  };
  const readJson = (relativePath: string) => JSON.parse(fs.readFileSync(path.join(rootDir, relativePath), 'utf8'));

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switch-catalog-'));
    fs.writeFileSync(
      path.join(rootDir, 'pnpm-workspace.yaml'),
      [
        'packages:',
        '  - packages/*',
        '  - e2e',
        '  - fixtures/package-tests/app',
        'catalogs:',
        '  default:',
        '    webdriverio: 10.1.0',
        '  minimum:',
        '    webdriverio: ^9.0.0',
        '',
      ].join('\n'),
    );
    writeJson('packages/svc/package.json', { dependencies: { webdriverio: 'catalog:default' } });
    writeJson('e2e/package.json', { dependencies: { webdriverio: 'catalog:default' } });
    writeJson('fixtures/package-tests/app/package.json', { dependencies: { webdriverio: '^10.1.0' } });
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('should switch the workspace packages and skip the fixtures', () => {
    expect(switchCatalog(rootDir, 'minimum', { wdioOnly: true })).toEqual(['e2e', 'packages/svc']);

    expect(readJson('packages/svc/package.json').dependencies.webdriverio).toBe('catalog:minimum');
    expect(readJson('e2e/package.json').dependencies.webdriverio).toBe('catalog:minimum');
    expect(readJson('fixtures/package-tests/app/package.json').dependencies.webdriverio).toBe('^10.1.0');
  });
});

describe('the minimum catalog', () => {
  const catalogs = readCatalogs(REPO_ROOT);
  const wdioPackages = (catalog: Record<string, string>) =>
    Object.keys(catalog).filter((dep) => dep === 'webdriverio' || dep.startsWith('@wdio/'));

  it('should hold WebdriverIO v9', () => {
    expect(catalogs.minimum.webdriverio).toMatch(/^[\^~]?9\./);
  });

  it('should cover every WebdriverIO package in the default catalog', () => {
    const missing = wdioPackages(catalogs.default).filter((dep) => !(dep in catalogs.minimum));

    // The only 9.x release of @wdio/display-server ships no build, so v9 runs keep the default 10.x.
    expect(missing).toEqual(['@wdio/display-server']);
  });
});
