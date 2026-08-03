import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createLogger, type NormalizedReadResult } from '@wdio/native-utils';
import findVersions from 'find-versions';
import { PKG_NAME_ELECTRON, PNPM_CATALOG_PREFIX } from './constants.js';
import { findPnpmCatalogVersion } from './pnpm.js';

const log = createLogger('electron-service', 'utils');

/**
 * Deliberately walks node_modules rather than using `require.resolve`, which also
 * consults NODE_PATH and Node's global folders — those can resolve an Electron
 * unrelated to the project under test.
 */
async function getInstalledVersion(pkgName: string, projectDir: string) {
  let currentDir = projectDir;

  while (true) {
    const manifestPath = join(currentDir, 'node_modules', pkgName, 'package.json');
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { version?: string };
      if (manifest.version) {
        return manifest.version;
      }
    } catch {
      // no install at this level, keep walking up
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      return undefined;
    }
    currentDir = parentDir;
  }
}

export async function getElectronVersion(pkg: NormalizedReadResult) {
  const projectDir = dirname(pkg.path);
  const { dependencies, devDependencies } = pkg.packageJson;

  const getElectronDependencies = async (pkgName: string) => {
    const deps = dependencies?.[pkgName] || devDependencies?.[pkgName];
    if (typeof deps === `undefined`) {
      return deps;
    }
    return deps.startsWith(PNPM_CATALOG_PREFIX) ? await findPnpmCatalogVersion(pkgName, deps, projectDir) : deps;
  };

  for (const pkgName of [PKG_NAME_ELECTRON.STABLE, PKG_NAME_ELECTRON.NIGHTLY]) {
    const declaredVersion = await getElectronDependencies(pkgName);
    if (!declaredVersion) {
      continue;
    }

    const parsedVersion = findVersions(declaredVersion, { loose: true })[0];
    if (parsedVersion) {
      return parsedVersion;
    }

    // The spec carries no version to parse — a dist-tag (`latest`, `next`, `beta`), a
    // wildcard, or a git / file spec. Chromedriver has to match the Electron that
    // actually got installed, so read that rather than giving up on the manifest.
    const installedVersion = await getInstalledVersion(pkgName, projectDir);
    if (installedVersion) {
      log.debug(`Resolved ${pkgName} v${installedVersion} from node_modules for spec "${declaredVersion}"`);
      return installedVersion;
    }
  }

  return undefined;
}
