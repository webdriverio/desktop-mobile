import { describe, expect, it } from 'vitest';
import { findCatalogRefs, resolveCatalogSpec } from '../../scripts/strip-fixture-catalogs.ts';

const REPO_ROOT = new URL('../..', import.meta.url).pathname;

// Package-test fixtures are installed in isolation (outside the workspace), where the `catalog:`
// protocol does not resolve — they must carry explicit versions. `pnpm up --latest` reintroduces
// catalog: refs for exact-pinned deps, so `update:dependencies` runs `strip-fixture-catalogs.ts`.
// This guard fails the (unconditional) lint CI job if any slip through.
describe('package-test fixtures', () => {
  it('should not reference the pnpm catalog', () => {
    const refs = findCatalogRefs(REPO_ROOT);
    const offending = refs.map((r) => `${r.file} → ${r.field}.${r.dep} = "${r.spec}"`);
    expect(offending, `strip with: pnpm exec node scripts/strip-fixture-catalogs.ts`).toEqual([]);
  });
});

describe('resolveCatalogSpec', () => {
  const catalogs = { default: { '@wdio/cli': '9.29.1' }, next: { '@wdio/cli': 'latest' } };

  it('should resolve a bare catalog: spec against the default catalog', () => {
    expect(resolveCatalogSpec('@wdio/cli', 'catalog:', catalogs)).toBe('9.29.1');
  });

  it('should resolve a named catalog:<name> spec', () => {
    expect(resolveCatalogSpec('@wdio/cli', 'catalog:next', catalogs)).toBe('latest');
  });

  it('should throw when the dep is absent from the target catalog', () => {
    expect(() => resolveCatalogSpec('missing-pkg', 'catalog:', catalogs)).toThrow(/No entry for "missing-pkg"/);
  });
});
