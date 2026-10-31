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
 * Runs on bare node (no pnpm install) in the detect job — Node 24 strips the
 * erasable type syntax natively, so keep this file free of enums, namespaces,
 * and parameter properties.
 *
 * Classification (first matching rule wins):
 *   - *.md anywhere            → docs (never triggers pipelines; lint runs unconditionally),
 *                                except packages/<pkg>/permissions/** (generated, shipped in the crate)
 *   - packages/native-types/** but its package.json → build (types only: build + unit, no service pipeline)
 *   - packages/native-*, packages/bundler        → shared (all services)
 *   - packages/<svc>[-...]/**                    → that service
 *   - packages/<unrecognised>/**                 → unknown (runs all — convention drift, fail loud)
 *   - e2e/test/<svc>[-...]/**, e2e/wdio.<svc>*.conf.ts → that service; other e2e/** → all (shared test infra)
 *   - fixtures/{e2e-apps,package-tests}/<svc>[-...]/** → that service; unrecognised dir → unknown
 *   - a .github/workflows/ YAML file whose diff only adds or removes comments and blank lines → none
 *     (main reads the diff from DIFF_BASE; if it can't, the file falls through to the rules below)
 *   - .github/workflows/: core-infra list → all; meta list → none;
 *     actions/** → all; service token in filename → that service; else → unknown
 *   - scripts/: service token in filename → that service; else → all (cross-service tooling)
 *   - the dependency manifests, compared with their copy at the merge-base (without one, or if the two match → all):
 *     - package.json: a devDependency → none if only release automation, the lint job or lint-staged uses it,
 *       build (build + unit, no service pipeline) if only installs, the build and the unit tests do, else all;
 *       a script only the lint job runs → none; any other change → all
 *     - e2e/package.json: a dependency → the services whose E2E configs and specs name it, or all if
 *       shared E2E code names it; any other change → all
 *     - pnpm-workspace.yaml: a catalog entry → as the packages that take it from that catalog, or
 *       none for a named catalog no package takes; any other change → all
 *     - pnpm-lock.yaml: an importer → as its package.json (root and e2e by dependency, others by
 *       path); the catalogs block → as pnpm-workspace.yaml; an edited package or snapshot, or any
 *       other top-level change → all; a package or snapshot that was only added or removed → none
 *   - tsconfig.scripts*.json → none (only typecheck:scripts, in the lint job, reads them)
 *   - root infra files (package.json, lockfile, turbo.json, tsconfig*…) → all
 *   - biome.jsonc, eslint.config.js → none (the lint job has no `if:` gate)
 *   - everything else (docs/, .claude/, dotfiles…) → none
 *
 * A releasekit release commit (RELEASE_COMMIT=true) runs lint only: it bumps versions, changelogs
 * and Cargo locks, and its publish doesn't wait for CI.
 *
 * 'all' and 'unknown' both run every pipeline; they differ only in reporting —
 * 'unknown' marks files no convention rule could place (likely naming drift) and is
 * called out separately in the step summary. Silent under-running is the failure
 * mode that hid real gaps before (#330), so drift over-runs, never under-runs.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

// 'none' | 'build' | 'shared' | 'all' | 'unknown', or service names discovered from packages/ (comma-separated).
type Verdict = string;

interface Classification {
  runs: Record<string, boolean>;
  sharedChanges: boolean;
  lintOnly: boolean;
  triggersAll: string[];
  unknownFiles: string[];
  commentOnlyFiles: string[];
  buildOnlyFiles: string[];
  sharedDetail: Array<{ file: string; pkg: string; services: string[] }>;
  perFile: Array<{ file: string; verdict: Verdict }>;
}

// Core CI orchestration: changes affect every service pipeline.
const CORE_INFRA_WORKFLOWS = new Set([
  'ci.yml',
  '_ci-detect-changes.reusable.yml',
  '_ci-build.reusable.yml',
  '_ci-lint.reusable.yml',
  '_ci-unit.reusable.yml',
  '_ci-package.reusable.yml',
]);

// Workflows the service tests can't exercise, so a change to one needs only the lint job (which runs actionlint).
const META_WORKFLOWS = new Set([
  'codeql.yml',
  'crate-drift.yml',
  'pr-title.yml',
  'auto-label-issues.yml',
  'expense.yml',
  'release.yml',
  '_release.reusable.yml',
  'standing-pr.yml',
  '_standing-pr-update.reusable.yml',
  'release-preview.yml',
  'release-preview-comment.yml',
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
// Root scripts that only the lint job runs (the tests check this), and the tsconfigs only they read.
export const LINT_JOB_SCRIPTS = new Set(['test:scripts', 'typecheck:scripts']);
export const SCRIPTS_TSCONFIG = /^tsconfig\.scripts(\.[^/]+)?\.json$/;

const SHARED_PACKAGE_PREFIXES = ['native-'];
const SHARED_PACKAGES = new Set(['bundler']);

// Types-only packages ship nothing but type declarations (erased at compile time), so a change
// to one can only break COMPILATION — caught by the always-on build + unit jobs — never a
// service's runtime. They therefore need build + unit only, not E2E or the jobs `has_shared_changes`
// gates. Guarded by test/scripts/native-types-types-only.spec.ts, which fails if real runtime code
// ever lands here.
const TYPES_ONLY_PACKAGES = new Set(['native-types']);

export function discoverServices(repoRoot: string): string[] {
  const packagesDir = path.join(repoRoot, 'packages');
  return fs
    .readdirSync(packagesDir)
    .filter((name) => name.endsWith('-service'))
    .map((name) => name.slice(0, -'-service'.length))
    .sort();
}

/**
 * Map each shared package dir → the service names that transitively depend on it, derived from
 * the `@wdio/*` deps in every package's `package.json`. A shared code change can then run only
 * the services it can actually affect at runtime (e.g. native-mobile-core → react-native +
 * flutter) instead of all of them. Reads package.json only — no install — so it still runs on the
 * bare-node detect job. Convention-driven: derived from real deps, never a hand-maintained map.
 */
export function buildServiceDependents(repoRoot: string, services: string[]): Record<string, string[]> {
  const packagesDir = path.join(repoRoot, 'packages');
  const dirByName: Record<string, string> = {};
  const wdioDepsByDir: Record<string, string[]> = {};
  for (const dir of fs.readdirSync(packagesDir)) {
    const pkgPath = path.join(packagesDir, dir, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      continue;
    }
    let pkg: { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    } catch {
      continue;
    }
    if (pkg.name) {
      dirByName[pkg.name] = dir;
    }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    wdioDepsByDir[dir] = Object.keys(deps).filter((d) => d.startsWith('@wdio/'));
  }
  // Transitive set of workspace package dirs a given dir depends on.
  const closure = (dir: string, seen: Set<string>): Set<string> => {
    for (const depName of wdioDepsByDir[dir] ?? []) {
      const depDir = dirByName[depName];
      if (depDir && !seen.has(depDir)) {
        seen.add(depDir);
        closure(depDir, seen);
      }
    }
    return seen;
  };
  const dependents: Record<string, string[]> = {};
  for (const svc of services) {
    for (const sharedDir of closure(`${svc}-service`, new Set<string>())) {
      if (!dependents[sharedDir]) {
        dependents[sharedDir] = [];
      }
      dependents[sharedDir].push(svc);
    }
  }
  for (const dir of Object.keys(dependents)) {
    dependents[dir].sort();
  }
  return dependents;
}

const WORKFLOW_YAML = /^\.github\/workflows\/.+\.ya?ml$/;

// A diff with no changed lines (a rename or mode change) doesn't count. A `#` line inside a block
// scalar, such as a heredoc or a github-script, looks like a comment here too.
export function isCommentOnlyYamlDiff(diff: string): boolean {
  let inHunk = false;
  let changed = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git')) {
      inHunk = false;
      continue;
    }
    if (line.startsWith('@@')) {
      inHunk = true;
      continue;
    }
    if (!inHunk || !(line.startsWith('+') || line.startsWith('-'))) {
      continue;
    }
    changed++;
    if (!/^\s*(#.*)?$/.test(line.slice(1))) {
      return false;
    }
  }
  return changed > 0;
}

// A file whose diff can't be read (readDiff returns undefined) keeps its usual verdict.
export function findCommentOnlyWorkflowChanges(
  files: string[],
  services: string[],
  readDiff: (file: string) => string | undefined,
): Set<string> {
  const commentOnly = new Set<string>();
  for (const file of files) {
    if (!WORKFLOW_YAML.test(file) || classifyFile(file, services) === 'none') {
      continue;
    }
    const diff = readDiff(file);
    if (diff !== undefined && isCommentOnlyYamlDiff(diff)) {
      commentOnly.add(file);
    }
  }
  return commentOnly;
}

// The commit where HEAD branched off DIFF_BASE, so later commits on the base branch don't count as this change.
function mergeBase(diffBase: string | undefined): string | undefined {
  if (!diffBase) {
    return undefined;
  }
  try {
    return execFileSync('git', ['merge-base', diffBase, 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return undefined;
  }
}

function gitDiffReader(base: string | undefined): (file: string) => string | undefined {
  return (file) => {
    if (!base) {
      return undefined;
    }
    try {
      return execFileSync('git', ['diff', '--unified=0', '--no-color', '--no-ext-diff', base, 'HEAD', '--', file], {
        encoding: 'utf8',
      });
    } catch {
      return undefined;
    }
  };
}

function serviceForDir(dir: string, services: string[]): string | undefined {
  return services.find((svc) => dir === svc || dir.startsWith(`${svc}-`));
}

function serviceForToken(filename: string, services: string[]): string | undefined {
  // Normalise every separator to a single '-' and frame the string with '-' so a
  // multi-word service name ('react-native') matches a hyphen-bounded token run in
  // '_ci-e2e-react-native-all-providers.reusable.yml'. A plain token-split would only
  // see 'react' and 'native' and never match the joined service name.
  const normalized = `-${filename.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-`;
  // Prefer the LONGEST matching service so a future short service (e.g. 'react') can't
  // shadow a longer one that contains it ('react-native') — both substring-match the same
  // filename, and a plain find() would return whichever sorts first.
  return services.filter((svc) => normalized.includes(`-${svc}-`)).sort((a, b) => b.length - a.length)[0];
}

const LOCKFILE_ENTRY_SECTIONS = new Set(['importers', 'packages', 'snapshots']);

// Root devDependencies that only release automation, the lint job or the local git hooks use.
const ROOT_INERT_DEV_DEP_PREFIXES = ['@releasekit/', '@biomejs/', 'eslint', '@typescript-eslint/'];
const ROOT_INERT_DEV_DEPS = new Set(['@vitest/eslint-plugin', 'globals', 'lint-staged']);
// Root devDependencies that only the build and unit tests use, and husky, which `prepare` runs on every install.
// The unit jobs install on every OS the pipelines use. Any other runs every pipeline.
const ROOT_BUILD_DEV_DEP_PREFIXES = ['@types/'];
const ROOT_BUILD_DEV_DEPS = new Set(['husky', 'typescript', 'vitest']);

const DIFF_MANIFEST_FILES = ['package.json', 'e2e/package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml'] as const;
type DiffManifestFile = (typeof DIFF_MANIFEST_FILES)[number];

export interface ManifestPair {
  base: string;
  head: string;
}

interface ParsedLockfile {
  entries: Record<'importers' | 'packages' | 'snapshots', Map<string, string>>;
  other: Map<string, string>;
}

interface ManifestEffect {
  all: boolean;
  unknown: boolean;
  // Needs build + unit, but no service pipeline.
  buildOnly: boolean;
  services: Set<string>;
  sharedDirs: string[];
}

// Without catalogConsumers or scriptDeps, a dependency they would place runs every pipeline.
interface ManifestContext {
  services: string[];
  e2eDeps: Record<string, string[]>;
  catalogConsumers?: CatalogConsumers;
  scriptDeps?: Set<string>;
}

// Catalog name → dependency → the importers, as pnpm-lock.yaml names them, that take it from that catalog.
type CatalogConsumers = Record<string, Record<string, string[]>>;

function emptyEffect(): ManifestEffect {
  return { all: false, unknown: false, buildOnly: false, services: new Set(), sharedDirs: [] };
}

function unreadableEffect(): ManifestEffect {
  return { ...emptyEffect(), all: true, unknown: true };
}

function addSharedDir(effect: ManifestEffect, dir: string): void {
  if (!effect.sharedDirs.includes(dir)) {
    effect.sharedDirs.push(dir);
  }
}

// Skips strings, so a comment opener in one, such as a `*.spec.ts` glob, stays code. A backslash outside a
// string escapes the next character, as `\/` does in a regex literal.
export function stripComments(text: string): string {
  let out = '';
  let quote: string | undefined;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    const next = text[i + 1] ?? '';
    if (quote) {
      if (ch === '\\') {
        out += ch + next;
        i++;
        continue;
      }
      if (ch === quote || (ch === '\n' && quote !== '`')) {
        quote = undefined;
      }
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      const end = text.indexOf('\n', i);
      i = (end === -1 ? text.length : end) - 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 1;
      out += ' ';
      continue;
    }
    if (ch === '\\') {
      out += ch + next;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
    }
    out += ch;
  }
  return out;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasWordMatch(text: string, token: string): boolean {
  return new RegExp(`(?<![a-z0-9-@/])${escapeRegex(token)}(?![a-z0-9-])`, 'i').test(text);
}

function e2eCandidateTokens(dep: string): string[] {
  const tokens = [dep.toLowerCase()];
  const wdioSvc = dep.match(/^@wdio\/(.+)-service$/);
  if (wdioSvc) {
    tokens.push(wdioSvc[1].toLowerCase());
  }
  const scoped = dep.match(/^@([^/]+)\/(.+)$/);
  if (scoped && !['wdio', 'types', 'vitest'].includes(scoped[1])) {
    tokens.push(scoped[1].toLowerCase(), scoped[2].toLowerCase());
  }
  if (dep.startsWith('appium-')) {
    tokens.push('appium');
  }
  return tokens;
}

// Maps each e2e dependency, and the short names it goes by, to the services whose E2E configs and
// specs name it. One that shared E2E code or an e2e script names maps to every service.
export function buildE2eDependencyServices(repoRoot: string, services: string[]): Record<string, string[]> {
  const e2eDir = path.join(repoRoot, 'e2e');
  if (!fs.existsSync(e2eDir)) {
    return {};
  }
  const serviceTexts: Record<string, string[]> = Object.fromEntries(services.map((svc) => [svc, []]));
  const sharedTexts: string[] = [];

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'logs') {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (/\.(ts|js|mjs)$/.test(entry.name)) {
        const relPath = path.relative(repoRoot, fullPath).split(path.sep).join('/');
        const verdict = classifyFile(relPath, services);
        const text = stripComments(fs.readFileSync(fullPath, 'utf8'));
        if (services.includes(verdict)) {
          serviceTexts[verdict].push(text);
        } else {
          sharedTexts.push(text);
        }
      }
    }
  };
  walk(e2eDir);

  const e2ePkgPath = path.join(e2eDir, 'package.json');
  const depNames = new Set<string>();
  if (fs.existsSync(e2ePkgPath)) {
    try {
      const e2ePkg = JSON.parse(fs.readFileSync(e2ePkgPath, 'utf8')) as {
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      sharedTexts.push(JSON.stringify(e2ePkg.scripts ?? {}));
      for (const dep of Object.keys({ ...e2ePkg.dependencies, ...e2ePkg.devDependencies })) {
        depNames.add(dep);
      }
    } catch {
      // classifyPackageJson runs every pipeline for a malformed e2e/package.json.
    }
  }

  const joinedServiceText: Record<string, string> = Object.fromEntries(
    services.map((svc) => [svc, serviceTexts[svc].join('\n').toLowerCase()]),
  );
  const joinedSharedText = sharedTexts.join('\n').toLowerCase();
  const allServices = [...services].sort();

  const resolveForDep = (dep: string): string[] => {
    const directSvc = serviceForToken(dep, services);
    if (directSvc) {
      return [directSvc];
    }
    if (dep.startsWith('@wdio/native-') || dep === '@wdio/bundler' || hasWordMatch(joinedSharedText, dep)) {
      return allServices;
    }
    const tokens = e2eCandidateTokens(dep);
    const matched = services.filter((svc) => tokens.some((tok) => hasWordMatch(joinedServiceText[svc], tok))).sort();
    return matched.length > 0 ? matched : allServices;
  };

  const result: Record<string, string[]> = {};
  for (const dep of depNames) {
    result[dep] = resolveForDep(dep);
    for (const token of e2eCandidateTokens(dep)) {
      if (!result[token]) {
        result[token] = resolveForDep(token);
      }
    }
  }
  return result;
}

const PACKAGE_DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];

// The workspace packages are the lockfile's importers, which CI's frozen install keeps in step with the workspace.
export function buildCatalogConsumers(repoRoot: string): CatalogConsumers | undefined {
  let lockfile: string;
  try {
    lockfile = fs.readFileSync(path.join(repoRoot, 'pnpm-lock.yaml'), 'utf8');
  } catch {
    return undefined;
  }
  if (!looksLikeLockfile(lockfile)) {
    return undefined;
  }
  const consumers: CatalogConsumers = {};
  for (const importer of parseLockfile(lockfile).entries.importers.keys()) {
    let pkg: unknown;
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, importer, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    if (!isPlainObject(pkg)) {
      continue;
    }
    for (const field of PACKAGE_DEPENDENCY_FIELDS) {
      const deps = pkg[field];
      if (!isPlainObject(deps)) {
        continue;
      }
      for (const [dep, spec] of Object.entries(deps)) {
        if (typeof spec !== 'string' || !spec.startsWith('catalog:')) {
          continue;
        }
        const catalog = spec.slice('catalog:'.length) || 'default';
        consumers[catalog] ??= {};
        consumers[catalog][dep] = [...new Set([...(consumers[catalog][dep] ?? []), importer])];
      }
    }
  }
  for (const byDep of Object.values(consumers)) {
    for (const importers of Object.values(byDep)) {
      importers.sort();
    }
  }
  return consumers;
}

export function buildScriptDependencies(repoRoot: string): Set<string> {
  const deps = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (/\.(ts|js|mjs|cjs)$/.test(entry.name)) {
        const text = fs.readFileSync(fullPath, 'utf8');
        for (const [, specifier] of text.matchAll(/\b(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/g)) {
          const name = specifier && packageName(specifier);
          if (name) {
            deps.add(name);
          }
        }
      }
    }
  };
  const scriptsDir = path.join(repoRoot, 'scripts');
  if (fs.existsSync(scriptsDir)) {
    walk(scriptsDir);
  }
  return deps;
}

function packageName(specifier: string): string | undefined {
  if (/^(\.|\/|node:)/.test(specifier)) {
    return undefined;
  }
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function matchesDep(dep: string, names: Set<string>, prefixes: string[]): boolean {
  return names.has(dep) || prefixes.some((prefix) => dep.startsWith(prefix));
}

type DepClassifier = (dep: string, ctx: ManifestContext, effect: ManifestEffect) => void;

// CI runs the scripts, so a package they import runs every pipeline, as a change to a script does.
function classifyRootDevDep(dep: string, ctx: ManifestContext, effect: ManifestEffect): void {
  if (!ctx.scriptDeps || ctx.scriptDeps.has(dep)) {
    effect.all = true;
  } else if (matchesDep(dep, ROOT_BUILD_DEV_DEPS, ROOT_BUILD_DEV_DEP_PREFIXES)) {
    effect.buildOnly = true;
  } else if (!matchesDep(dep, ROOT_INERT_DEV_DEPS, ROOT_INERT_DEV_DEP_PREFIXES)) {
    effect.all = true;
  }
}

function servicesForE2eDep(dep: string, ctx: ManifestContext): string[] {
  const fromMap = ctx.e2eDeps[dep];
  if (fromMap && fromMap.length > 0) {
    return fromMap;
  }
  const directSvc = serviceForToken(dep, ctx.services);
  if (directSvc) {
    return [directSvc];
  }
  for (const token of e2eCandidateTokens(dep)) {
    const tokenSvcs = ctx.e2eDeps[token];
    if (tokenSvcs && tokenSvcs.length > 0) {
      return tokenSvcs;
    }
  }
  return ctx.services;
}

function classifyE2eDep(dep: string, ctx: ManifestContext, effect: ManifestEffect): void {
  const matched = servicesForE2eDep(dep, ctx);
  if (matched.length === 0 || matched.length >= ctx.services.length) {
    effect.all = true;
    return;
  }
  for (const svc of matched) {
    effect.services.add(svc);
  }
}

// The root and e2e manifests, and their lockfile importers, narrow by each changed dependency in `fields`.
// Any other change runs every pipeline, unless `isInert` says it needs none.
interface DependencyRules {
  fields: readonly string[];
  classify: DepClassifier;
  isInert?: (field: string, base: unknown, head: unknown) => boolean;
}
const ROOT_DEPENDENCY_RULES: DependencyRules = {
  fields: ['devDependencies'],
  classify: classifyRootDevDep,
  isInert: (field, base, head) => field === 'scripts' && onlyLintJobScriptsChanged(base, head),
};
const E2E_DEPENDENCY_RULES: DependencyRules = { fields: ['dependencies', 'devDependencies'], classify: classifyE2eDep };

// An importer other than the root and e2e runs what a change to its package.json would. A types-only package has no
// dependencies (the tests check this), so its importer resolves only what its types build against.
function classifyImporterByPath(importer: string, ctx: ManifestContext, effect: ManifestEffect): void {
  const sharedDir = importer.match(/^packages\/([^/]+)$/)?.[1];
  if (sharedDir && TYPES_ONLY_PACKAGES.has(sharedDir)) {
    effect.buildOnly = true;
    return;
  }
  const verdict = classifyFile(`${importer}/package.json`, ctx.services);
  if (verdict === 'shared' && sharedDir) {
    addSharedDir(effect, sharedDir);
  } else if (ctx.services.includes(verdict)) {
    effect.services.add(verdict);
  } else {
    effect.all = true;
  }
}

function classifyCatalogDep({ catalog, dep }: CatalogEntry, ctx: ManifestContext, effect: ManifestEffect): void {
  if (!ctx.catalogConsumers) {
    effect.all = true;
    return;
  }
  const importers = ctx.catalogConsumers[catalog]?.[dep] ?? [];
  if (importers.length === 0) {
    // CI never switches catalogs (the tests check this), so it never installs a named-catalog entry no package takes.
    if (catalog === 'default') {
      effect.all = true;
    }
    return;
  }
  for (const importer of importers) {
    if (importer === 'e2e') {
      classifyE2eDep(dep, ctx, effect);
    } else if (importer === '.') {
      classifyRootDevDep(dep, ctx, effect);
    } else {
      classifyImporterByPath(importer, ctx, effect);
    }
  }
}

interface CatalogEntry {
  catalog: string;
  dep: string;
  value: string;
}

function classifyCatalogChanges(
  base: Map<string, CatalogEntry>,
  head: Map<string, CatalogEntry>,
  ctx: ManifestContext,
  effect: ManifestEffect,
): void {
  for (const key of new Set([...base.keys(), ...head.keys()])) {
    const entry = head.get(key) ?? base.get(key);
    if (entry && base.get(key)?.value !== head.get(key)?.value) {
      classifyCatalogDep(entry, ctx, effect);
    }
  }
}

function changedRecordKeys(base: Record<string, unknown>, head: Record<string, unknown>): string[] {
  const changed: string[] = [];
  for (const key of new Set([...Object.keys(base), ...Object.keys(head)])) {
    if (JSON.stringify(base[key]) !== JSON.stringify(head[key])) {
      changed.push(key);
    }
  }
  return changed;
}

function onlyLintJobScriptsChanged(base: unknown, head: unknown): boolean {
  const baseScripts = base ?? {};
  const headScripts = head ?? {};
  if (!isPlainObject(baseScripts) || !isPlainObject(headScripts)) {
    return false;
  }
  return changedRecordKeys(baseScripts, headScripts).every((name) => LINT_JOB_SCRIPTS.has(name));
}

function classifyPackageJson(pair: ManifestPair, rules: DependencyRules, ctx: ManifestContext): ManifestEffect {
  let base: unknown;
  let head: unknown;
  try {
    base = JSON.parse(pair.base);
    head = JSON.parse(pair.head);
  } catch {
    return unreadableEffect();
  }
  if (!isPlainObject(base) || !isPlainObject(head)) {
    return unreadableEffect();
  }
  const effect = emptyEffect();
  for (const field of changedRecordKeys(base, head)) {
    if (rules.isInert?.(field, base[field], head[field])) {
      continue;
    }
    const baseDeps = base[field] ?? {};
    const headDeps = head[field] ?? {};
    if (!rules.fields.includes(field) || !isPlainObject(baseDeps) || !isPlainObject(headDeps)) {
      effect.all = true;
      return effect;
    }
    for (const dep of changedRecordKeys(baseDeps, headDeps)) {
      rules.classify(dep, ctx, effect);
    }
  }
  return effect;
}

// A key at exactly `indent` spaces: `key:` opens a block, and `key: {}` is pnpm's inline form for an entry with no body.
function splitIndentedKeyLine(line: string, indent: number): { key: string; inline: string } | undefined {
  const prefix = ' '.repeat(indent);
  if (!line.startsWith(prefix) || line.startsWith(`${prefix} `)) {
    return undefined;
  }
  const rest = line.slice(indent).trimEnd();
  if (!rest || rest.startsWith('#')) {
    return undefined;
  }
  let keyEnd: number;
  if (rest.startsWith("'") || rest.startsWith('"')) {
    keyEnd = rest.indexOf(rest[0] as string, 1) + 1;
  } else {
    const separator = rest.indexOf(': ');
    keyEnd = separator === -1 ? rest.length - 1 : separator;
  }
  if (keyEnd <= 0 || rest[keyEnd] !== ':') {
    return undefined;
  }
  return { key: unquoteLockKey(rest.slice(0, keyEnd)), inline: rest.slice(keyEnd + 1).trim() };
}

interface ParsedWorkspaceYaml {
  catalogs: Map<string, CatalogEntry>;
  other: Map<string, string>;
  valid: boolean;
}

function parseWorkspaceYaml(text: string): ParsedWorkspaceYaml {
  const catalogs = new Map<string, CatalogEntry>();
  const other = new Map<string, string>();
  let section: string | undefined;
  let catalogName = 'default';
  let sawTopLevel = false;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    if (!line.startsWith(' ')) {
      const colon = line.indexOf(':');
      if (colon <= 0) {
        return { catalogs, other, valid: false };
      }
      sawTopLevel = true;
      section = line.slice(0, colon).trim();
      catalogName = 'default';
      const inline = line.slice(colon + 1).replace(/\s#.*$/, '');
      if (section !== 'catalogs' && section !== 'catalog') {
        const prev = other.get(section);
        other.set(section, prev === undefined ? line : `${prev}\n${line}`);
      } else if (inline.trim()) {
        // A flow-style `catalog: { … }` holds its entries on this line, which the readers below don't parse.
        return { catalogs, other, valid: false };
      }
      continue;
    }
    if (!section) {
      return { catalogs, other, valid: false };
    }
    if (section === 'catalogs') {
      const catEntry = splitIndentedKeyLine(line, 2);
      if (catEntry && catEntry.inline === '') {
        catalogName = catEntry.key;
        continue;
      }
      const depEntry = splitIndentedKeyLine(line, 4);
      if (depEntry && depEntry.inline !== '') {
        catalogs.set(`${catalogName}\0${depEntry.key}`, {
          catalog: catalogName,
          dep: depEntry.key,
          value: depEntry.inline,
        });
        continue;
      }
      return { catalogs, other, valid: false };
    }
    if (section === 'catalog') {
      const depEntry = splitIndentedKeyLine(line, 2);
      if (depEntry && depEntry.inline !== '') {
        catalogs.set(`default\0${depEntry.key}`, { catalog: 'default', dep: depEntry.key, value: depEntry.inline });
        continue;
      }
      return { catalogs, other, valid: false };
    }
    const prev = other.get(section) ?? '';
    other.set(section, prev ? `${prev}\n${line}` : line);
  }
  return { catalogs, other, valid: sawTopLevel };
}

function classifyWorkspaceYaml(pair: ManifestPair, ctx: ManifestContext): ManifestEffect {
  const base = parseWorkspaceYaml(pair.base);
  const head = parseWorkspaceYaml(pair.head);
  if (!base.valid || !head.valid) {
    return unreadableEffect();
  }
  const effect = emptyEffect();
  if (changedMapKeys(base.other, head.other).length > 0) {
    effect.all = true;
    return effect;
  }
  classifyCatalogChanges(base.catalogs, head.catalogs, ctx, effect);
  return effect;
}

function unquoteLockKey(raw: string): string {
  if (raw.length >= 2) {
    const quote = raw[0];
    if ((quote === "'" || quote === '"') && raw.endsWith(quote)) {
      return raw.slice(1, -1);
    }
  }
  return raw;
}

// pnpm-lock.yaml is two YAML documents, with entries under importers, packages and snapshots. The detect
// job has no YAML parser, so this reads it line by line.
function parseLockfile(text: string): ParsedLockfile {
  const entries: ParsedLockfile['entries'] = {
    importers: new Map(),
    packages: new Map(),
    snapshots: new Map(),
  };
  const other = new Map<string, string>();
  let section: string | undefined;
  let entryKey: string | undefined;
  let entryLines: string[] = [];

  const flushEntry = () => {
    if (!section || !entryKey || !LOCKFILE_ENTRY_SECTIONS.has(section)) {
      return;
    }
    const bucket = entries[section as 'importers' | 'packages' | 'snapshots'];
    // Blank lines separate entries, so they mustn't count as part of the one they follow.
    while (entryLines.at(-1)?.trim() === '') {
      entryLines.pop();
    }
    const body = entryLines.join('\n');
    const previous = bucket.get(entryKey);
    bucket.set(entryKey, previous === undefined ? body : `${previous}\n${body}`);
    entryKey = undefined;
    entryLines = [];
  };

  for (const rawLine of text.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line === '---' || line === '...') {
      flushEntry();
      section = undefined;
      continue;
    }
    if (line.length > 0 && !line.startsWith(' ') && !line.startsWith('#')) {
      flushEntry();
      const colon = line.indexOf(':');
      section = colon === -1 ? line : line.slice(0, colon);
      if (!LOCKFILE_ENTRY_SECTIONS.has(section)) {
        const previous = other.get(section);
        other.set(section, previous === undefined ? line : `${previous}\n${line}`);
      }
      continue;
    }
    if (!section) {
      continue;
    }
    if (LOCKFILE_ENTRY_SECTIONS.has(section)) {
      const entry = splitIndentedKeyLine(line, 2);
      if (entry) {
        flushEntry();
        entryKey = entry.key;
        if (entry.inline) {
          entryLines.push(entry.inline);
        }
        continue;
      }
      if (entryKey) {
        entryLines.push(line);
      }
      continue;
    }
    const previous = other.get(section) ?? '';
    other.set(section, previous ? `${previous}\n${line}` : line);
  }
  flushEntry();
  return { entries, other };
}

function looksLikeLockfile(text: string): boolean {
  return text.includes('lockfileVersion:') && text.includes('\nimporters:');
}

function canonicalLockfile(parsed: ParsedLockfile): string {
  const dump = (map: Map<string, string>) =>
    [...map.entries()]
      .sort(([a], [b]) => {
        if (a < b) {
          return -1;
        }
        if (a > b) {
          return 1;
        }
        return 0;
      })
      .map(([key, body]) => `${key}\n${body}`)
      .join('\n');
  return [
    dump(parsed.other),
    dump(parsed.entries.importers),
    dump(parsed.entries.packages),
    dump(parsed.entries.snapshots),
  ].join('\n---\n');
}

interface ParsedImporterBody {
  sections: Map<string, Map<string, string>>;
  other: Map<string, string>;
  valid: boolean;
}

function parseLockImporterBody(body: string): ParsedImporterBody {
  const sections = new Map<string, Map<string, string>>();
  const other = new Map<string, string>();
  if (body.trim() === '' || body.trim() === '{}') {
    return { sections, other, valid: true };
  }
  let currentSection: string | undefined;
  let currentDep: string | undefined;

  for (const rawLine of body.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!line.trim() || line.trim().startsWith('#')) {
      continue;
    }
    const secEntry = splitIndentedKeyLine(line, 4);
    if (secEntry) {
      currentDep = undefined;
      if (secEntry.inline !== '') {
        currentSection = undefined;
        other.set(secEntry.key, secEntry.inline);
      } else {
        currentSection = secEntry.key;
        if (!sections.has(currentSection)) {
          sections.set(currentSection, new Map());
        }
      }
      continue;
    }
    const depEntry = splitIndentedKeyLine(line, 6);
    if (depEntry && currentSection) {
      currentDep = depEntry.key;
      const bucket = sections.get(currentSection);
      if (bucket) {
        bucket.set(currentDep, depEntry.inline);
      }
      continue;
    }
    if (line.startsWith('        ') && currentSection && currentDep) {
      const bucket = sections.get(currentSection);
      if (bucket) {
        const prev = bucket.get(currentDep) ?? '';
        bucket.set(currentDep, prev ? `${prev}\n${line}` : line);
      }
      continue;
    }
    return { sections, other, valid: false };
  }
  return { sections, other, valid: true };
}

function parseLockCatalogs(text: string | undefined): { entries: Map<string, CatalogEntry>; valid: boolean } {
  const entries = new Map<string, CatalogEntry>();
  if (!text) {
    return { entries, valid: true };
  }
  let catalogName: string | undefined;
  let currentKey: string | undefined;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!line.trim() || line.trim().startsWith('#') || line === 'catalogs:') {
      continue;
    }
    const catEntry = splitIndentedKeyLine(line, 2);
    if (catEntry && catEntry.inline === '') {
      catalogName = catEntry.key;
      currentKey = undefined;
      continue;
    }
    const depEntry = splitIndentedKeyLine(line, 4);
    if (depEntry && catalogName) {
      currentKey = `${catalogName}\0${depEntry.key}`;
      entries.set(currentKey, { catalog: catalogName, dep: depEntry.key, value: depEntry.inline });
      continue;
    }
    if (line.startsWith('      ') && currentKey) {
      const prev = entries.get(currentKey);
      if (prev) {
        prev.value = prev.value ? `${prev.value}\n${line}` : line;
      }
      continue;
    }
    return { entries, valid: false };
  }
  return { entries, valid: true };
}

function changedMapKeys(base: Map<string, string>, head: Map<string, string>): string[] {
  const changed: string[] = [];
  for (const key of new Set([...base.keys(), ...head.keys()])) {
    if ((base.get(key) ?? '') !== (head.get(key) ?? '')) {
      changed.push(key);
    }
  }
  return changed;
}

// The top-level `(…)` groups in `text`, without their parentheses.
function parenGroups(text: string): string[] {
  const groups: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') {
      if (depth === 0) {
        start = i + 1;
      }
      depth++;
    } else if (text[i] === ')') {
      depth--;
      if (depth === 0) {
        groups.push(text.slice(start, i));
      }
    }
  }
  return groups;
}

// `version:` ends with the dependency's resolved peers, as `(name@version…)` groups. A peer that's also one of the
// importer's dependencies is classified by its own entry, so only the other peers count.
function withoutOwnPeers(entry: string, ownDeps: Set<string>): string {
  return entry.replace(/^([ \t]*version: [^(\s]+)(\(.*\))$/m, (_match, version: string, peers: string) => {
    const others = parenGroups(peers).filter((peer) => !ownDeps.has(peer.slice(0, peer.indexOf('@', 1))));
    return version + others.map((peer) => `(${peer})`).join('');
  });
}

function classifyImporterDeps(
  baseBody: string | undefined,
  headBody: string | undefined,
  rules: DependencyRules,
  ctx: ManifestContext,
  effect: ManifestEffect,
): void {
  const base = parseLockImporterBody(baseBody ?? '');
  const head = parseLockImporterBody(headBody ?? '');
  if (!base.valid || !head.valid || changedMapKeys(base.other, head.other).length > 0) {
    effect.all = true;
    return;
  }
  const ownDeps = new Set([...base.sections.values(), ...head.sections.values()].flatMap((deps) => [...deps.keys()]));
  let changedAny = false;
  for (const field of new Set([...base.sections.keys(), ...head.sections.keys()])) {
    const baseDeps = base.sections.get(field) ?? new Map<string, string>();
    const headDeps = head.sections.get(field) ?? new Map<string, string>();
    const changed = [...new Set([...baseDeps.keys(), ...headDeps.keys()])].filter(
      (dep) => withoutOwnPeers(baseDeps.get(dep) ?? '', ownDeps) !== withoutOwnPeers(headDeps.get(dep) ?? '', ownDeps),
    );
    if (changed.length > 0 && !rules.fields.includes(field)) {
      effect.all = true;
      return;
    }
    for (const dep of changed) {
      rules.classify(dep, ctx, effect);
    }
    changedAny ||= changed.length > 0;
  }
  // The body changed but no dependency did, so it can't place the change.
  if (!changedAny) {
    effect.all = true;
  }
}

function classifyLockfile(pair: ManifestPair, ctx: ManifestContext): ManifestEffect {
  if (!looksLikeLockfile(pair.base) || !looksLikeLockfile(pair.head)) {
    return unreadableEffect();
  }
  const base = parseLockfile(pair.base);
  const head = parseLockfile(pair.head);
  const effect = emptyEffect();

  for (const name of changedMapKeys(base.other, head.other)) {
    const baseCatalogs = name === 'catalogs' ? parseLockCatalogs(base.other.get(name)) : undefined;
    const headCatalogs = name === 'catalogs' ? parseLockCatalogs(head.other.get(name)) : undefined;
    if (baseCatalogs?.valid && headCatalogs?.valid) {
      classifyCatalogChanges(baseCatalogs.entries, headCatalogs.entries, ctx, effect);
    } else {
      effect.all = true;
    }
  }

  for (const key of changedMapKeys(base.entries.importers, head.entries.importers)) {
    const baseBody = base.entries.importers.get(key);
    const headBody = head.entries.importers.get(key);
    if (key === '.' || key === 'e2e') {
      const rules = key === '.' ? ROOT_DEPENDENCY_RULES : E2E_DEPENDENCY_RULES;
      classifyImporterDeps(baseBody, headBody, rules, ctx, effect);
    } else {
      classifyImporterByPath(key, ctx, effect);
    }
  }

  // Only in-place edits count. Anything that uses a newly added package also changes an importer or an
  // existing snapshot, which is classified.
  for (const section of ['packages', 'snapshots'] as const) {
    const baseEntries = base.entries[section];
    const headEntries = head.entries[section];
    for (const key of new Set([...baseEntries.keys(), ...headEntries.keys()])) {
      if (baseEntries.has(key) && headEntries.has(key) && baseEntries.get(key) !== headEntries.get(key)) {
        effect.all = true;
      }
    }
  }

  // The text changed but no entry the reader understands did, so it can't place the change: run everything.
  if (
    !effect.all &&
    !effect.buildOnly &&
    effect.services.size === 0 &&
    effect.sharedDirs.length === 0 &&
    pair.base !== pair.head &&
    canonicalLockfile(base) === canonicalLockfile(head)
  ) {
    return unreadableEffect();
  }
  return effect;
}

function manifestVerdict(effect: ManifestEffect): Verdict {
  if (effect.unknown) {
    return 'unknown';
  }
  if (effect.all) {
    return 'all';
  }
  if (effect.sharedDirs.length > 0) {
    return 'shared';
  }
  if (effect.services.size > 0) {
    return [...effect.services].sort().join(',');
  }
  return effect.buildOnly ? 'build' : 'none';
}

function diffBaseRef(): string | undefined {
  const baseRef = process.env.DIFF_BASE ?? '';
  // Reject anything that isn't a plain ref, and a new branch's all-zero before-sha.
  if (!/^[A-Za-z0-9._/-]+$/.test(baseRef) || baseRef.startsWith('-') || /^0+$/.test(baseRef)) {
    return undefined;
  }
  return baseRef;
}

function readManifestPairs(files: string[], base: string | undefined): Partial<Record<DiffManifestFile, ManifestPair>> {
  const pairs: Partial<Record<DiffManifestFile, ManifestPair>> = {};
  if (!base) {
    return pairs;
  }
  for (const file of DIFF_MANIFEST_FILES) {
    if (!files.includes(file)) {
      continue;
    }
    try {
      pairs[file] = {
        base: execFileSync('git', ['show', `${base}:${file}`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }),
        head: fs.readFileSync(file, 'utf8'),
      };
    } catch {
      // A file without both copies runs every pipeline (see classifyChanges).
    }
  }
  return pairs;
}

export function classifyFile(file: string, services: string[]): Verdict {
  // Generated permission docs ship in the plugin crates, so a change to them must run that service's CI.
  const isPermissionsFile = /^packages\/[^/]+\/permissions\//.test(file);
  if (file.endsWith('.md') && !isPermissionsFile) {
    return 'none';
  }

  const pkg = file.match(/^packages\/([^/]+)\//);
  if (pkg) {
    const dir = pkg[1];
    // Its package.json still decides what its consumers install, through its peers, exports and files.
    if (TYPES_ONLY_PACKAGES.has(dir) && file !== `packages/${dir}/package.json`) {
      return 'build';
    }
    if (SHARED_PACKAGES.has(dir) || SHARED_PACKAGE_PREFIXES.some((p) => dir.startsWith(p))) {
      return 'shared';
    }
    return serviceForDir(dir, services) ?? 'unknown';
  }

  if (file.startsWith('e2e/')) {
    const test = file.match(/^e2e\/test\/([^/]+)\//);
    // serviceForDir (not exact match) so suffixed dirs like `dioxus-browser`
    // route to their service — mirrors the wdio.<svc>-*.conf.ts rule below.
    if (test) {
      return serviceForDir(test[1], services) ?? 'all';
    }
    const conf = file.match(/^e2e\/wdio\.([^/]+)\.conf\.ts$/);
    if (conf) {
      return serviceForDir(conf[1], services) ?? 'all';
    }
    return 'all';
  }

  const fixture = file.match(/^fixtures\/(?:e2e-apps|package-tests)\/([^/]+)\//);
  if (fixture) {
    return serviceForDir(fixture[1], services) ?? 'unknown';
  }
  if (file.startsWith('fixtures/')) {
    return 'unknown';
  }

  if (file.startsWith('.github/workflows/actions/')) {
    return 'all';
  }
  if (file.startsWith('.github/workflows/')) {
    const name = path.basename(file);
    if (CORE_INFRA_WORKFLOWS.has(name)) {
      return 'all';
    }
    if (META_WORKFLOWS.has(name)) {
      return 'none';
    }
    return serviceForToken(name, services) ?? 'unknown';
  }
  if (file.startsWith('.github/')) {
    return 'none';
  }

  if (file.startsWith('scripts/')) {
    return serviceForToken(path.basename(file), services) ?? 'all';
  }

  if (!file.includes('/')) {
    if (LINT_ONLY_FILES.has(file)) {
      return 'none';
    }
    if (ROOT_INFRA_FILES.has(file)) {
      return 'all';
    }
    if (SCRIPTS_TSCONFIG.test(file)) {
      return 'none';
    }
    if (file.startsWith('tsconfig') && file.endsWith('.json')) {
      return 'all';
    }
  }

  return 'none';
}

// Services whose E2E a shared-package change must run. The bundler changes every package's build output, so all.
// Otherwise its transitive dependents, or every service for a shared package with none known.
function affectedServices(dir: string, services: string[], dependents: Record<string, string[]>): string[] {
  if (SHARED_PACKAGES.has(dir)) {
    return services;
  }
  return dependents[dir]?.length ? dependents[dir] : services;
}

function classifyManifestFile(file: DiffManifestFile, pair: ManifestPair, ctx: ManifestContext): ManifestEffect {
  switch (file) {
    case 'package.json':
      return classifyPackageJson(pair, ROOT_DEPENDENCY_RULES, ctx);
    case 'e2e/package.json':
      return classifyPackageJson(pair, E2E_DEPENDENCY_RULES, ctx);
    case 'pnpm-workspace.yaml':
      return classifyWorkspaceYaml(pair, ctx);
    case 'pnpm-lock.yaml':
      return classifyLockfile(pair, ctx);
  }
}

export function classifyChanges(
  files: string[],
  services: string[],
  {
    forceAll = false,
    releaseCommit = false,
    dependents = {} as Record<string, string[]>,
    e2eDeps = {} as Record<string, string[]>,
    catalogConsumers,
    scriptDeps,
    manifests = {},
    commentOnly = new Set<string>(),
  }: {
    forceAll?: boolean;
    releaseCommit?: boolean;
    dependents?: Record<string, string[]>;
    e2eDeps?: Record<string, string[]>;
    catalogConsumers?: CatalogConsumers;
    scriptDeps?: Set<string>;
    manifests?: Partial<Record<DiffManifestFile, ManifestPair>>;
    commentOnly?: Set<string>;
  } = {},
): Classification {
  const runs: Record<string, boolean> = Object.fromEntries(services.map((svc) => [svc, false]));
  let sharedChanges = false;
  let buildOnly = false;
  // Deliberate run-everything verdicts (core infra, cross-service scripts, shared e2e)
  // vs files no convention rule could place — both run all pipelines, but only the
  // latter signal naming-convention drift.
  const triggersAll: string[] = [];
  const unknownFiles: string[] = [];
  const buildOnlyFiles: string[] = [];
  const sharedDetail: Classification['sharedDetail'] = [];

  if (forceAll) {
    for (const svc of services) {
      runs[svc] = true;
    }
    return {
      runs,
      sharedChanges: true,
      lintOnly: false,
      triggersAll,
      unknownFiles,
      commentOnlyFiles: [],
      buildOnlyFiles,
      sharedDetail,
      perFile: [],
    };
  }

  if (releaseCommit) {
    return {
      runs,
      sharedChanges: false,
      lintOnly: true,
      triggersAll,
      unknownFiles,
      commentOnlyFiles: [],
      buildOnlyFiles,
      sharedDetail,
      perFile: [],
    };
  }

  // A shared-package change always needs build + unit; affectedServices decides which services' E2E it can
  // affect at runtime.
  const addSharedChange = (file: string, dir: string) => {
    sharedChanges = true;
    const affected = affectedServices(dir, services, dependents);
    for (const svc of affected) {
      runs[svc] = true;
    }
    sharedDetail.push({ file, pkg: dir, services: affected });
  };

  const ctx: ManifestContext = { services, e2eDeps, catalogConsumers, scriptDeps };
  const perFile: Array<{ file: string; verdict: Verdict }> = [];
  const commentOnlyFiles: string[] = [];
  for (const file of files) {
    if (commentOnly.has(file)) {
      commentOnlyFiles.push(file);
      perFile.push({ file, verdict: 'none' });
      continue;
    }
    if ((DIFF_MANIFEST_FILES as readonly string[]).includes(file)) {
      const manifestFile = file as DiffManifestFile;
      const pair = manifests[manifestFile];
      // Listed as changed but the same as at the base: the file list and the base disagree, as on a manual run on main.
      if (!pair || pair.base === pair.head) {
        perFile.push({ file, verdict: 'all' });
        triggersAll.push(file);
        for (const svc of services) {
          runs[svc] = true;
        }
        continue;
      }
      const effect = classifyManifestFile(manifestFile, pair, ctx);
      buildOnly ||= effect.buildOnly;
      if (effect.all) {
        if (effect.unknown) {
          unknownFiles.push(file);
        } else {
          triggersAll.push(file);
        }
        for (const svc of services) {
          runs[svc] = true;
        }
      }
      for (const dir of effect.sharedDirs) {
        addSharedChange(file, dir);
      }
      for (const svc of effect.services) {
        if (services.includes(svc)) {
          runs[svc] = true;
        } else {
          unknownFiles.push(file);
          for (const every of services) {
            runs[every] = true;
          }
        }
      }
      const verdict = manifestVerdict(effect);
      if (verdict === 'build') {
        buildOnlyFiles.push(file);
      }
      perFile.push({ file, verdict });
      continue;
    }
    const verdict = classifyFile(file, services);
    perFile.push({ file, verdict });
    if (verdict === 'none') {
      continue;
    }
    if (verdict === 'build') {
      buildOnly = true;
      buildOnlyFiles.push(file);
    } else if (verdict === 'shared') {
      addSharedChange(file, (file.match(/^packages\/([^/]+)\//) as RegExpMatchArray)[1] as string);
    } else if (verdict === 'all' || verdict === 'unknown') {
      if (verdict === 'all') {
        triggersAll.push(file);
      } else {
        unknownFiles.push(file);
      }
      for (const svc of services) {
        runs[svc] = true;
      }
    } else {
      runs[verdict] = true;
    }
  }

  // Lint-only = nothing needs build: no service runs AND no shared-package or build-only change
  // (build + unit gate on `run_lint_only != true`).
  const lintOnly = services.every((svc) => !runs[svc]) && !sharedChanges && !buildOnly;
  return {
    runs,
    sharedChanges,
    lintOnly,
    triggersAll,
    unknownFiles,
    commentOnlyFiles,
    buildOnlyFiles,
    sharedDetail,
    perFile,
  };
}

function appendFile(envVar: string, content: string): void {
  const target = process.env[envVar];
  if (target) {
    fs.appendFileSync(target, content);
  }
}

function main(): void {
  const files: string[] = JSON.parse(process.env.CHANGED_FILES || '[]');
  const forceAll = process.env.FORCE_ALL === 'true';
  const releaseCommit = process.env.RELEASE_COMMIT === 'true';
  const services = discoverServices(process.cwd());
  const dependents = buildServiceDependents(process.cwd(), services);
  const e2eDeps = buildE2eDependencyServices(process.cwd(), services);
  const catalogConsumers = buildCatalogConsumers(process.cwd());
  const scriptDeps = buildScriptDependencies(process.cwd());
  const base = mergeBase(diffBaseRef());
  const manifests = readManifestPairs(files, base);
  const commentOnly = findCommentOnlyWorkflowChanges(files, services, gitDiffReader(base));

  const {
    runs,
    sharedChanges,
    lintOnly,
    triggersAll,
    unknownFiles,
    commentOnlyFiles,
    buildOnlyFiles,
    sharedDetail,
    perFile,
  } = classifyChanges(files, services, {
    forceAll,
    releaseCommit,
    dependents,
    e2eDeps,
    catalogConsumers,
    scriptDeps,
    manifests,
    commentOnly,
  });

  let output = '';
  for (const [svc, run] of Object.entries(runs)) {
    output += `run_${svc}=${run}\n`;
  }
  output += `runs=${JSON.stringify(runs)}\n`;
  output += `has_shared_changes=${sharedChanges}\n`;
  output += `run_lint_only=${lintOnly}\n`;
  appendFile('GITHUB_OUTPUT', output);

  let summary = '## Change Detection Summary\n\n';
  summary += forceAll ? '**Force-all mode** — running everything.\n\n' : '';
  summary += releaseCommit && !forceAll ? '**Release commit** — lint only.\n\n' : '';
  summary += '| Service | Run |\n|---------|-----|\n';
  for (const [svc, run] of Object.entries(runs)) {
    summary += `| ${svc} | ${run} |\n`;
  }
  summary += `\n- Shared package changes: ${sharedChanges}\n- Lint only: ${lintOnly}\n`;
  if (sharedDetail.length > 0) {
    summary += '\n### Shared package changes (narrowed to runtime dependents)\n\n';
    summary += 'build + unit run regardless; E2E runs only for the services a shared change can affect:\n\n';
    for (const { file, pkg, services: svcs } of sharedDetail) {
      summary += `- \`${file}\` (${pkg}) → ${svcs.join(', ')}\n`;
    }
  }
  if (buildOnlyFiles.length > 0) {
    summary += '\n### Files that need only build and unit\n\n';
    for (const file of buildOnlyFiles) {
      summary += `- \`${file}\`\n`;
    }
  }
  if (triggersAll.length > 0) {
    summary += '\n### Core infra / cross-service changes (run all pipelines)\n\n';
    for (const file of triggersAll) {
      summary += `- \`${file}\`\n`;
    }
  }
  if (commentOnlyFiles.length > 0) {
    summary += '\n### Comment-only workflow changes (no pipelines)\n\n';
    for (const file of commentOnlyFiles) {
      summary += `- \`${file}\`\n`;
    }
  }
  if (unknownFiles.length > 0) {
    summary += '\n### ⚠️ Unclassified files (running all pipelines defensively)\n\n';
    summary += 'No naming-convention rule places these — possible convention drift. ';
    summary += 'Either rename to match the conventions or teach `scripts/detect-changes.ts` about them:\n\n';
    for (const file of unknownFiles) {
      summary += `- \`${file}\`\n`;
    }
  }
  appendFile('GITHUB_STEP_SUMMARY', summary);

  console.log(`services: ${services.join(', ')}`);
  for (const { file, verdict } of perFile) {
    console.log(`  ${verdict.padEnd(7)} ${file}`);
  }
  console.log(output.trimEnd());
}

if (import.meta.main) {
  main();
}
