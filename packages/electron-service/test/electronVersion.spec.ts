// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NormalizedPackageJson, NormalizedReadResult } from '@wdio/native-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getElectronVersion } from '../src/electronVersion.js';
import { findPnpmCatalogVersion } from '../src/pnpm.js';

vi.mock('../src/pnpm', async () => {
  return {
    findPnpmCatalogVersion: vi.fn(),
  };
});

function createPackageJson(depName: string, dep: { [key: string]: string }) {
  const pkgJson = {
    name: 'my-app',
    version: '1.0.0',
  } as NormalizedPackageJson;
  pkgJson[depName] = dep;
  return pkgJson;
}

const projectDirs: string[] = [];

/**
 * Real on-disk project so `createRequire(...).resolve()` is exercised for the
 * node_modules fallback rather than stubbed out.
 */
async function createProject(deps: { [key: string]: string }, installed: { [key: string]: string } = {}) {
  const projectDir = await mkdtemp(join(tmpdir(), 'wdio-electron-version-'));
  projectDirs.push(projectDir);

  const manifestPath = join(projectDir, 'package.json');
  await writeFile(manifestPath, JSON.stringify({ name: 'my-app', version: '1.0.0', devDependencies: deps }));

  for (const [pkgName, version] of Object.entries(installed)) {
    const installedDir = join(projectDir, 'node_modules', pkgName);
    await mkdir(installedDir, { recursive: true });
    await writeFile(join(installedDir, 'package.json'), JSON.stringify({ name: pkgName, version, main: 'index.js' }));
  }

  return {
    packageJson: createPackageJson('devDependencies', deps),
    path: manifestPath,
  } as NormalizedReadResult;
}

beforeEach(() => {
  vi.mocked(findPnpmCatalogVersion).mockReset();
});

afterEach(async () => {
  await Promise.all(projectDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});
describe('getElectronVersion()', () => {
  it('should return the electron version from package.json dependencies', async () => {
    const pkg = {
      packageJson: createPackageJson('dependencies', { electron: '25.0.1' }),
      path: '/path/to/package.json',
    } as NormalizedReadResult;
    const version = await getElectronVersion(pkg);
    expect(version).toBe('25.0.1');
  });

  it('should return the electron version from package.json devDependencies', async () => {
    const pkg = {
      packageJson: createPackageJson('devDependencies', { electron: '25.0.1' }),
      path: '/path/to/package.json',
    } as NormalizedReadResult;
    const version = await getElectronVersion(pkg);
    expect(version).toBe('25.0.1');
  });

  it('should return the nightly electron version from package.json dependencies', async () => {
    const pkg = {
      packageJson: createPackageJson('dependencies', {
        'electron-nightly': '33.0.0-nightly.20240621',
      }),
      path: '/path/to/package.json',
    } as NormalizedReadResult;
    const version = await getElectronVersion(pkg);
    expect(version).toBe('33.0.0-nightly.20240621');
  });

  it('should prioritize electron over electron-nightly when both are set package.json dependencies', async () => {
    const pkg = {
      packageJson: createPackageJson('dependencies', {
        electron: '25.0.1',
        'electron-nightly': '33.0.0-nightly.20240621',
      }),
      path: '/path/to/package.json',
    } as NormalizedReadResult;
    const version = await getElectronVersion(pkg);
    expect(version).toBe('25.0.1');
  });

  it('should return the nightly electron version from package.json devDependencies', async () => {
    const pkg = {
      packageJson: createPackageJson('devDependencies', {
        'electron-nightly': '33.0.0-nightly.20240621',
      }),
      path: '/path/to/package.json',
    } as NormalizedReadResult;
    const version = await getElectronVersion(pkg);
    expect(version).toBe('33.0.0-nightly.20240621');
  });

  it('should return undefined when there is no electron dependency', async () => {
    const pkg = {
      packageJson: createPackageJson('dependencies', {}),
      path: '/path/to/package.json',
    } as NormalizedReadResult;
    const version = await getElectronVersion(pkg);
    expect(version).toBeUndefined();
  });

  it('should fetch the electron version from pnpm workspace', async () => {
    vi.mocked(findPnpmCatalogVersion).mockResolvedValueOnce('^29.4.1');

    const pkg = {
      packageJson: createPackageJson('devDependencies', { electron: 'catalog:' }),
      path: '/path/to/project/package.json',
    } as NormalizedReadResult;

    const version = await getElectronVersion(pkg);
    expect(version).toBe('29.4.1');
  });

  it('should fetch the electron-nightly version from pnpm workspace', async () => {
    // if the version is specified with caret(^), the return value would be "33.0.0"
    vi.mocked(findPnpmCatalogVersion).mockResolvedValueOnce('33.0.0-nightly.20240621');

    const pkg = {
      packageJson: createPackageJson('devDependencies', { 'electron-nightly': 'catalog:' }),
      path: '/path/to/project/package.json',
    } as NormalizedReadResult;

    const version = await getElectronVersion(pkg);
    expect(version).toBe('33.0.0-nightly.20240621');
  });

  it('should prioritize electron over electron-nightly when both are set pnpm catalog', async () => {
    vi.mocked(findPnpmCatalogVersion).mockResolvedValueOnce('29.4.1').mockResolvedValueOnce('33.0.0-nightly.20240621');

    const pkg = {
      packageJson: createPackageJson('dependencies', {
        electron: 'catalog:',
        'electron-nightly': 'catalog:',
      }),
      path: '/path/to/package.json',
    } as NormalizedReadResult;
    const version = await getElectronVersion(pkg);
    expect(version).toBe('29.4.1');
  });

  describe('when the declared version is not parseable semver', () => {
    it.each(['latest', 'next', 'beta', '*'])(
      'should fall back to the installed electron version for "%s"',
      async (spec) => {
        const pkg = await createProject({ electron: spec }, { electron: '43.2.0' });

        const version = await getElectronVersion(pkg);
        expect(version).toBe('43.2.0');
      },
    );

    it('should fall back to the installed electron version for a pnpm catalog dist-tag', async () => {
      vi.mocked(findPnpmCatalogVersion).mockResolvedValueOnce('latest');

      const pkg = await createProject({ electron: 'catalog:next' }, { electron: '43.2.0' });

      const version = await getElectronVersion(pkg);
      expect(version).toBe('43.2.0');
    });

    it('should fall back to the installed electron-nightly version', async () => {
      const pkg = await createProject(
        { 'electron-nightly': 'latest' },
        { 'electron-nightly': '44.0.0-nightly.20260803' },
      );

      const version = await getElectronVersion(pkg);
      expect(version).toBe('44.0.0-nightly.20260803');
    });

    it('should fall through to electron-nightly when electron is not installed', async () => {
      const pkg = await createProject(
        { electron: 'latest', 'electron-nightly': '44.0.0-nightly.20260803' },
        { 'electron-nightly': '44.0.0-nightly.20260803' },
      );

      const version = await getElectronVersion(pkg);
      expect(version).toBe('44.0.0-nightly.20260803');
    });

    it('should return undefined when electron is not installed either', async () => {
      const pkg = await createProject({ electron: 'latest' });

      const version = await getElectronVersion(pkg);
      expect(version).toBeUndefined();
    });
  });

  it('should prefer the declared version over the installed one when it is parseable', async () => {
    const pkg = await createProject({ electron: '37.10.3' }, { electron: '43.2.0' });

    const version = await getElectronVersion(pkg);
    expect(version).toBe('37.10.3');
  });

  describe('when the declared version points at a location', () => {
    it.each([
      ['file:../electron', 'file'],
      ['link:../electron', 'link'],
      ['workspace:*', 'workspace'],
      ['npm:my-electron-fork@latest', 'npm alias'],
      ['github:myorg/electron-fork#my-branch', 'git'],
      ['https://cdn.corp.net/builds/electron.tgz', 'url'],
    ])('should use the installed version for a %s spec', async (spec) => {
      const pkg = await createProject({ electron: spec }, { electron: '43.2.0' });

      const version = await getElectronVersion(pkg);
      expect(version).toBe('43.2.0');
    });

    it('should not mistake a version-looking path segment for the electron version', async () => {
      const pkg = await createProject({ electron: 'file:/build/v1.2.3/electron' }, { electron: '43.2.0' });

      const version = await getElectronVersion(pkg);
      expect(version).toBe('43.2.0');
    });

    it('should fall back to parsing the spec when nothing is installed', async () => {
      const pkg = await createProject({ electron: 'file:../vendor/electron-37.2.1.tgz' });

      const version = await getElectronVersion(pkg);
      expect(version).toBe('37.2.1');
    });
  });
});
