import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createLogger, type NormalizedReadResult } from '@wdio/native-utils';
import findVersions from 'find-versions';
import { PKG_NAME_ELECTRON, PNPM_CATALOG_PREFIX } from './constants.js';
import { findPnpmCatalogVersion } from './pnpm.js';

const log = createLogger('electron-service', 'utils');

/** Specs that point at a location — a path, repo or tarball — rather than constraining a version. */
const LOCATION_SPEC_PATTERN = /^(file|link|portal|workspace|npm|git|git\+[a-z]+|github|gitlab|bitbucket|gist|https?):/;

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

    // A location spec is a path, not a constraint, so any version-looking substring in
    // it is incidental — `file:/build/v1.2.3/electron` is not Electron 1.2.3. Read the
    // install first for those, and parse the spec first for everything else. Either way
    // the other is tried as a fallback, since a dist-tag, a partial range (`^37`) or a
    // wildcard carries no version to parse.
    const readInstalledFirst = LOCATION_SPEC_PATTERN.test(declaredVersion);
    const readInstalled = async () => {
      const installedVersion = await getInstalledVersion(pkgName, projectDir);
      if (installedVersion) {
        log.debug(`Resolved ${pkgName} v${installedVersion} from node_modules for spec "${declaredVersion}"`);
      }
      return installedVersion;
    };
    const parseSpec = async () => findVersions(declaredVersion, { loose: true })[0];

    for (const resolve of readInstalledFirst ? [readInstalled, parseSpec] : [parseSpec, readInstalled]) {
      const version = await resolve();
      if (version) {
        return version;
      }
    }
  }

  return undefined;
}
