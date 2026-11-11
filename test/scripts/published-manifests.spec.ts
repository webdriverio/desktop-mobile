import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const ENGINES_NODE = '>=22.23.4 <23 || >=24.22.1 <25 || >=26.12.1';
const WDIO_PEER_RANGE = '^9.33.0 || ^10.2.0';

const PACKAGES_DIR = fileURLToPath(new URL('../../packages/', import.meta.url));

interface Manifest {
  name: string;
  private?: boolean;
  engines?: Record<string, string>;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

type BundleFormat = { bundle?: string[] } | boolean | undefined;

const manifests = readdirSync(PACKAGES_DIR)
  .map((dir) => join(PACKAGES_DIR, dir))
  .filter((dir) => existsSync(join(dir, 'package.json')))
  .map((dir) => ({ dir, manifest: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Manifest }));

// Packages the bundler inlines into every build format, so the published code never imports them.
async function inlined(dir: string): Promise<Set<string>> {
  const configPath = join(dir, 'wdio-bundler.config.ts');
  if (!existsSync(configPath)) {
    return new Set();
  }
  const config: { esm?: BundleFormat; cjs?: BundleFormat } = (await import(pathToFileURL(configPath).href)).default;
  const bundled = (format: BundleFormat) => (typeof format === 'object' ? (format.bundle ?? []) : []);
  const cjs = new Set(bundled(config.cjs));
  return new Set(bundled(config.esm).filter((name) => cjs.has(name)));
}

const IMPORT_PATTERN = /(?:\bfrom|\bimport|\brequire\(|\bimport\(|declare module)\s*['"]((?:@[\w.-]+\/)?[\w.-]+)/g;

function importedPackages(dir: string): Set<string> {
  const imported = new Set<string>();
  for (const sourceDir of ['src', 'guest-js']) {
    const root = join(dir, sourceDir);
    if (!existsSync(root)) {
      continue;
    }
    for (const file of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
      if (!/\.[cm]?[jt]s$/.test(file) || /(^|[\\/])__tests__[\\/]|\.(spec|test)\.[cm]?[jt]s$/.test(file)) {
        continue;
      }
      for (const [, specifier] of readFileSync(join(root, file), 'utf8').matchAll(IMPORT_PATTERN)) {
        imported.add(specifier);
      }
    }
  }
  return imported;
}

const workspaceNames = new Set(manifests.map(({ manifest }) => manifest.name));
const published = await Promise.all(
  manifests
    .filter(({ manifest }) => !manifest.private)
    .map(async (pkg) => ({ ...pkg, inlined: await inlined(pkg.dir), imported: importedPackages(pkg.dir) })),
);

// WebdriverIO's own packages, as opposed to the @wdio/native-* ones published from this repo.
const isWdio = (name: string) => name === 'webdriverio' || (name.startsWith('@wdio/') && !workspaceNames.has(name));

describe('published package manifests', () => {
  it('should find the published packages', () => {
    expect(published.length).toBeGreaterThan(0);
  });

  it('should declare the same Node engines everywhere', () => {
    expect(Object.fromEntries(published.map(({ manifest }) => [manifest.name, manifest.engines?.node]))).toEqual(
      Object.fromEntries(published.map(({ manifest }) => [manifest.name, ENGINES_NODE])),
    );
  });

  describe.each(published.map((pkg) => ({ name: pkg.manifest.name, ...pkg })))(
    '$name',
    ({ manifest, inlined, imported }) => {
      const wdioPeers = Object.keys(manifest.peerDependencies ?? {}).filter(isWdio);

      it('should accept both WebdriverIO majors in its WebdriverIO peers', () => {
        expect(Object.fromEntries(wdioPeers.map((name) => [name, manifest.peerDependencies?.[name]]))).toEqual(
          Object.fromEntries(wdioPeers.map((name) => [name, WDIO_PEER_RANGE])),
        );
      });

      it('should mark its WebdriverIO peers optional', () => {
        const unmarked = wdioPeers.filter((name) => manifest.peerDependenciesMeta?.[name]?.optional !== true);
        expect(unmarked).toEqual([]);
      });

      it('should not depend on WebdriverIO packages directly', () => {
        expect(Object.keys(manifest.dependencies ?? {}).filter(isWdio)).toEqual([]);
      });

      // Type-only imports count too: the emitted .d.ts files keep them.
      it('should declare every @wdio package its source imports', () => {
        const declared = new Set([
          manifest.name,
          ...inlined,
          ...Object.keys(manifest.dependencies ?? {}),
          ...Object.keys(manifest.peerDependencies ?? {}),
        ]);
        const undeclared = [...imported].filter(
          (name) => (name === 'webdriverio' || name.startsWith('@wdio/')) && !declared.has(name),
        );
        expect(undeclared).toEqual([]);
      });
    },
  );
});
