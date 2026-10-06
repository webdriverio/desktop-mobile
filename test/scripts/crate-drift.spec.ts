import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const REPO_ROOT = new URL('../../', import.meta.url);

// A published crate missing from crate-drift.yml's matrix is never built against fresh dependencies.
const workflow = parse(readFileSync(new URL('.github/workflows/crate-drift.yml', REPO_ROOT), 'utf8'));
const legs: Array<{ label: string; targets: string; crates: string }> =
  workflow.jobs['fresh-deps'].strategy.matrix.include;
const cratesOf = (leg: { crates: string }) => leg.crates.trim().split(/\s+/).sort();

const publishedCrates = readdirSync(new URL('packages/', REPO_ROOT), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => `packages/${entry.name}`)
  .filter((dir) => {
    try {
      return !/^publish\s*=\s*false/m.test(readFileSync(new URL(`${dir}/Cargo.toml`, REPO_ROOT), 'utf8'));
    } catch {
      return false;
    }
  })
  .sort();

describe('crate-drift workflow', () => {
  it('should build every published crate on the Linux leg', () => {
    const linux = legs.find((leg) => leg.label.startsWith('Linux'));
    expect(linux && cratesOf(linux)).toEqual(publishedCrates);
  });

  it('should cross-check every published crate for Windows', () => {
    const windows = legs.filter((leg) => leg.targets.split(/\s+/).includes('x86_64-pc-windows-msvc')).flatMap(cratesOf);
    expect([...new Set(windows)].sort()).toEqual(publishedCrates);
  });

  it('should only list crates that exist', () => {
    for (const leg of legs) expect(publishedCrates).toEqual(expect.arrayContaining(cratesOf(leg)));
  });
});
