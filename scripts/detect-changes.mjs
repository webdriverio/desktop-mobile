#!/usr/bin/env node
/**
 * Convention-driven CI change classifier (see issue #331).
 *
 * Replaces the hand-maintained per-service dorny filter block: services are
 * discovered from `packages/*-service`, and changed files are classified by the
 * repo's naming conventions. Adding a service requires NO edits here — only the
 * ci.yml jobs and per-service reusable workflows (which are inherently
 * per-service).
 *
 * Plain .mjs rather than .ts: the detect job runs this before any pnpm install,
 * so it must execute on bare node.
 *
 * Classification (first matching rule wins):
 *   - *.md anywhere            → docs (never triggers pipelines; lint runs unconditionally)
 *   - packages/native-*, packages/bundler        → shared (all services)
 *   - packages/<svc>[-...]/**                    → that service
 *   - packages/<unrecognised>/**                 → unknown (runs all — convention drift, fail loud)
 *   - e2e/test/<svc>/**, e2e/wdio.<svc>*.conf.ts → that service; other e2e/** → all (shared test infra)
 *   - fixtures/{e2e-apps,package-tests}/<svc>[-...]/** → that service; unrecognised dir → unknown
 *   - .github/workflows/: core-infra list → all; meta list → none;
 *     actions/** → all; service token in filename → that service; else → unknown
 *   - scripts/: service token in filename → that service; else → all (cross-service tooling)
 *   - root infra files (package.json, lockfile, turbo.json, tsconfig*…) → all
 *   - biome.jsonc, eslint.config.js → none (the lint job has no `if:` gate)
 *   - everything else (docs/, agent-os/, .claude/, dotfiles…) → none
 *
 * 'all' and 'unknown' both run every pipeline; they differ only in reporting —
 * 'unknown' marks files no convention rule could place (likely naming drift) and is
 * called out separately in the step summary. Silent under-running is the failure
 * mode that hid real gaps before (#330), so drift over-runs, never under-runs.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// Core CI orchestration + release workflows: changes affect every service pipeline.
const CORE_INFRA_WORKFLOWS = new Set([
  'ci.yml',
  '_ci-detect-changes.reusable.yml',
  '_ci-build.reusable.yml',
  '_ci-lint.reusable.yml',
  '_ci-unit.reusable.yml',
  '_ci-package.reusable.yml',
  'release.yml',
  '_release.reusable.yml',
]);

// Meta-workflows that never require service tests.
const META_WORKFLOWS = new Set([
  'codeql.yml',
  'pr-title.yml',
  'auto-label-issues.yml',
  'expense.yml',
  'release-preview.yml',
]);

// Workspace / dependency / build / test configuration at the repo root.
const ROOT_INFRA_FILES = new Set([
  'package.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  '.nvmrc',
  'turbo.json',
  'version.config.json',
  'vitest.config.ts',
  'wdio.conf.ts',
]);

// The lint job runs unconditionally, so lint config alone never needs pipelines.
const LINT_ONLY_FILES = new Set(['biome.jsonc', 'eslint.config.js']);

const SHARED_PACKAGE_PREFIXES = ['native-'];
const SHARED_PACKAGES = new Set(['bundler']);

export function discoverServices(repoRoot) {
  const packagesDir = path.join(repoRoot, 'packages');
  return fs
    .readdirSync(packagesDir)
    .filter((name) => name.endsWith('-service'))
    .map((name) => name.slice(0, -'-service'.length))
    .sort();
}

function serviceForDir(dir, services) {
  return services.find((svc) => dir === svc || dir.startsWith(`${svc}-`));
}

function serviceForToken(filename, services) {
  // Normalise every separator to a single '-' and frame the string with '-' so a
  // multi-word service name ('react-native') matches a hyphen-bounded token run in
  // '_ci-e2e-react-native-all-providers.reusable.yml'. A plain token-split would only
  // see 'react' and 'native' and never match the joined service name.
  const normalized = `-${filename.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-`;
  // Prefer the LONGEST matching service so a future short service (e.g. 'react') can't
  // shadow a longer one that contains it ('react-native') — both substring-match the same
  // filename, and a plain find() would return whichever sorts first.
  return services
    .filter((svc) => normalized.includes(`-${svc}-`))
    .sort((a, b) => b.length - a.length)[0];
}

/**
 * Classify one changed file.
 * Returns: 'none' | 'shared' | 'all' | a service name.
 */
export function classifyFile(file, services) {
  if (file.endsWith('.md')) return 'none';

  const pkg = file.match(/^packages\/([^/]+)\//);
  if (pkg) {
    const dir = pkg[1];
    if (SHARED_PACKAGES.has(dir) || SHARED_PACKAGE_PREFIXES.some((p) => dir.startsWith(p))) return 'shared';
    return serviceForDir(dir, services) ?? 'unknown';
  }

  if (file.startsWith('e2e/')) {
    const test = file.match(/^e2e\/test\/([^/]+)\//);
    if (test) return services.includes(test[1]) ? test[1] : 'all';
    const conf = file.match(/^e2e\/wdio\.([^/]+)\.conf\.ts$/);
    if (conf) return serviceForDir(conf[1], services) ?? 'all';
    return 'all';
  }

  const fixture = file.match(/^fixtures\/(?:e2e-apps|package-tests)\/([^/]+)\//);
  if (fixture) return serviceForDir(fixture[1], services) ?? 'unknown';
  if (file.startsWith('fixtures/')) return 'unknown';

  if (file.startsWith('.github/workflows/actions/')) return 'all';
  if (file.startsWith('.github/workflows/')) {
    const name = path.basename(file);
    if (CORE_INFRA_WORKFLOWS.has(name)) return 'all';
    if (META_WORKFLOWS.has(name)) return 'none';
    return serviceForToken(name, services) ?? 'unknown';
  }
  if (file.startsWith('.github/')) return 'none';

  if (file.startsWith('scripts/')) {
    return serviceForToken(path.basename(file), services) ?? 'all';
  }

  if (!file.includes('/')) {
    if (LINT_ONLY_FILES.has(file)) return 'none';
    if (ROOT_INFRA_FILES.has(file)) return 'all';
    if (file.startsWith('tsconfig') && file.endsWith('.json')) return 'all';
  }

  return 'none';
}

export function classifyChanges(files, services, { forceAll = false } = {}) {
  const runs = Object.fromEntries(services.map((svc) => [svc, false]));
  let sharedChanges = false;
  // Deliberate run-everything verdicts (core infra, cross-service scripts, shared e2e)
  // vs files no convention rule could place — both run all pipelines, but only the
  // latter signal naming-convention drift.
  const triggersAll = [];
  const unknownFiles = [];

  if (forceAll) {
    for (const svc of services) runs[svc] = true;
    return { runs, sharedChanges: true, lintOnly: false, triggersAll, unknownFiles, perFile: [] };
  }

  const perFile = [];
  for (const file of files) {
    const verdict = classifyFile(file, services);
    perFile.push({ file, verdict });
    if (verdict === 'none') continue;
    if (verdict === 'shared' || verdict === 'all' || verdict === 'unknown') {
      if (verdict === 'shared') sharedChanges = true;
      else if (verdict === 'all') triggersAll.push(file);
      else unknownFiles.push(file);
      for (const svc of services) runs[svc] = true;
    } else {
      runs[verdict] = true;
    }
  }

  const lintOnly = services.every((svc) => !runs[svc]);
  return { runs, sharedChanges, lintOnly, triggersAll, unknownFiles, perFile };
}

function appendFile(envVar, content) {
  const target = process.env[envVar];
  if (target) fs.appendFileSync(target, content);
}

function main() {
  const files = JSON.parse(process.env.CHANGED_FILES || '[]');
  const forceAll = process.env.FORCE_ALL === 'true';
  const services = discoverServices(process.cwd());

  const { runs, sharedChanges, lintOnly, triggersAll, unknownFiles, perFile } = classifyChanges(files, services, {
    forceAll,
  });

  let output = '';
  for (const [svc, run] of Object.entries(runs)) output += `run_${svc}=${run}\n`;
  output += `runs=${JSON.stringify(runs)}\n`;
  output += `has_shared_changes=${sharedChanges}\n`;
  output += `run_lint_only=${lintOnly}\n`;
  appendFile('GITHUB_OUTPUT', output);

  let summary = '## Change Detection Summary\n\n';
  summary += forceAll ? '**Force-all mode** — running everything.\n\n' : '';
  summary += '| Service | Run |\n|---------|-----|\n';
  for (const [svc, run] of Object.entries(runs)) summary += `| ${svc} | ${run} |\n`;
  summary += `\n- Shared package changes: ${sharedChanges}\n- Lint only: ${lintOnly}\n`;
  if (triggersAll.length > 0) {
    summary += '\n### Core infra / cross-service changes (run all pipelines)\n\n';
    for (const file of triggersAll) summary += `- \`${file}\`\n`;
  }
  if (unknownFiles.length > 0) {
    summary += '\n### ⚠️ Unclassified files (running all pipelines defensively)\n\n';
    summary += 'No naming-convention rule places these — possible convention drift. ';
    summary += 'Either rename to match the conventions or teach `scripts/detect-changes.mjs` about them:\n\n';
    for (const file of unknownFiles) summary += `- \`${file}\`\n`;
  }
  appendFile('GITHUB_STEP_SUMMARY', summary);

  console.log(`services: ${services.join(', ')}`);
  for (const { file, verdict } of perFile) console.log(`  ${verdict.padEnd(7)} ${file}`);
  console.log(output.trimEnd());
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}
