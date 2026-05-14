#!/usr/bin/env tsx
/**
 * Aggregate dry-run validator for the Dioxus release pipeline.
 *
 * Mirrors what `_release.reusable.yml` does at publish time, minus the
 * actual `publish` step:
 *
 *   - `pnpm pack` for each npm package (verifies packaging shape).
 *   - `cargo publish --dry-run --allow-dirty` for each crate (verifies
 *     manifest, path-dep version pins, packaging).
 *
 * Use it locally before triggering the release workflow so the most
 * common publish-time failures (missing files entries, path-dep without
 * a version, version-sync drift) surface in seconds rather than the
 * first time the workflow runs against the real registries.
 *
 * Usage:
 *
 *   pnpm release:dry-run            # all dioxus artefacts + native-core
 *   pnpm release:dry-run dioxus     # dioxus-scope packages only
 *   pnpm release:dry-run core       # @wdio/native-core only
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PACK_DIR = '/tmp';

type Kind = 'npm' | 'crate';

interface Artefact {
  name: string;
  kind: Kind;
  packagePath: string;
  scope: 'core' | 'dioxus';
  /** Tolerable failure substring — when present in stderr, the artefact is reported as "expected-fail" rather than hard-fail. */
  tolerate?: string;
}

const ARTEFACTS: Artefact[] = [
  { name: '@wdio/native-core', kind: 'npm', packagePath: 'packages/native-core', scope: 'core' },
  { name: '@wdio/dioxus-service', kind: 'npm', packagePath: 'packages/dioxus-service', scope: 'dioxus' },
  { name: '@wdio/dioxus-bridge', kind: 'npm', packagePath: 'packages/dioxus-bridge', scope: 'dioxus' },
  { name: 'wdio-dioxus-bridge', kind: 'crate', packagePath: 'packages/dioxus-bridge', scope: 'dioxus' },
  { name: 'wdio-dioxus-driver', kind: 'crate', packagePath: 'packages/dioxus-driver', scope: 'dioxus' },
  {
    name: 'wdio-dioxus-embedded-driver',
    kind: 'crate',
    packagePath: 'packages/dioxus-embedded-driver',
    scope: 'dioxus',
    // Embedded-driver depends on wdio-dioxus-bridge by path+version. Cargo
    // resolves the path dep locally but `--dry-run` ALSO requires the
    // version to exist on crates.io. Until the first real bridge publish,
    // this is the expected error and the release workflow publishes in
    // order so the real publish succeeds.
    tolerate: 'no matching package named `wdio-dioxus-bridge` found',
  },
];

type Outcome = 'pass' | 'expected-fail' | 'fail';

interface Result {
  artefact: Artefact;
  outcome: Outcome;
  detail?: string;
}

function run(cmd: string, cwd: string): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
    return { code: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      code: e.status ?? 1,
      stdout: (e.stdout?.toString() ?? '').trim(),
      stderr: (e.stderr?.toString() ?? '').trim(),
    };
  }
}

function dryPack(a: Artefact): Result {
  const dir = join(ROOT, a.packagePath);
  if (!existsSync(dir)) {
    return { artefact: a, outcome: 'fail', detail: `directory missing: ${dir}` };
  }
  const r = run(`pnpm pack --pack-destination ${PACK_DIR}`, dir);
  if (r.code === 0) return { artefact: a, outcome: 'pass' };
  return { artefact: a, outcome: 'fail', detail: r.stderr || r.stdout };
}

function dryPublishCrate(a: Artefact): Result {
  const dir = join(ROOT, a.packagePath);
  if (!existsSync(join(dir, 'Cargo.toml'))) {
    return { artefact: a, outcome: 'fail', detail: `Cargo.toml missing: ${dir}` };
  }
  const r = run('cargo publish --dry-run --allow-dirty', dir);
  if (r.code === 0) return { artefact: a, outcome: 'pass' };
  const haystack = `${r.stdout}\n${r.stderr}`;
  if (a.tolerate && haystack.includes(a.tolerate)) {
    return { artefact: a, outcome: 'expected-fail', detail: a.tolerate };
  }
  return { artefact: a, outcome: 'fail', detail: r.stderr || r.stdout };
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

function main(): void {
  const wantedScope = process.argv[2] as Artefact['scope'] | undefined;
  if (wantedScope && wantedScope !== 'dioxus' && wantedScope !== 'core') {
    console.error(`unknown scope: ${wantedScope} (expected 'dioxus' or 'core', or no arg for both)`);
    process.exit(2);
  }
  const targets = ARTEFACTS.filter((a) => !wantedScope || a.scope === wantedScope);

  console.log('Building workspace first (release artefacts must be in sync with source)…');
  run('pnpm build', ROOT);

  console.log(`Validating ${targets.length} artefact(s)…\n`);
  const results: Result[] = [];
  for (const a of targets) {
    process.stdout.write(`• ${pad(a.name, 32)} ${a.kind} … `);
    const r = a.kind === 'npm' ? dryPack(a) : dryPublishCrate(a);
    results.push(r);
    const tag = r.outcome === 'pass' ? '✅ pass' : r.outcome === 'expected-fail' ? '⚠️  expected-fail' : '❌ FAIL';
    console.log(tag);
  }

  const failed = results.filter((r) => r.outcome === 'fail');
  if (failed.length > 0) {
    console.log('\nFailures:');
    for (const f of failed) {
      console.log(`\n— ${f.artefact.name}`);
      console.log(f.detail ?? '(no detail)');
    }
    process.exit(1);
  }

  const tolerated = results.filter((r) => r.outcome === 'expected-fail');
  if (tolerated.length > 0) {
    console.log('\nExpected failures (release workflow handles via publish ordering):');
    for (const t of tolerated) {
      console.log(`  ${t.artefact.name}: ${t.detail}`);
    }
  }

  console.log('\n✅ Dry-run validation complete.');
}

main();
