#!/usr/bin/env node

// Moves third-party `uses:` pins to the newest tag, which is what closes Dependabot's
// github-actions PRs. releasekit stays with update:releasekit. Floating refs (`@stable`, `@v2.x`) stay put.
// A major-only pin (`@v7`) moves to the newest major tag, not to a patch pin.

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const RELEASEKIT_REPO = 'goosewobbler/releasekit';
const SKIP_DIRS = new Set(['node_modules', '.git', 'target', 'dist', '.turbo']);
const SHA_RE = /^[0-9a-f]{40}$/i;
const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)$/;
const MAJOR_RE = /^v?(\d+)$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export interface RemoteTag {
  name: string;
  /** Peeled commit. Annotated tags must not keep the tag object id. */
  sha: string;
}

export interface ActionUse {
  repo: string;
  subpath: string;
  version: string;
}

export interface PinChange {
  label: string;
  from: string;
  to: string;
  major: boolean;
}

export function parseActionUse(token: string): ActionUse | undefined {
  const at = token.lastIndexOf('@');
  if (at <= 0) {
    return;
  }
  const name = token.slice(0, at);
  if (name.startsWith('.') || name.startsWith('docker://')) {
    return;
  }
  const parts = name.split('/');
  if (parts.length < 2 || !REPO_RE.test(`${parts[0]}/${parts[1]}`)) {
    return;
  }
  return { repo: `${parts[0]}/${parts[1]}`, subpath: parts.slice(2).join('/'), version: token.slice(at + 1) };
}

export function formatActionUse(action: ActionUse, version: string): string {
  return `${action.repo}${action.subpath ? `/${action.subpath}` : ''}@${version}`;
}

export function parseLsRemoteTags(output: string): RemoteTag[] {
  const peeled = new Map<string, string>();
  const lightweight = new Map<string, string>();
  for (const line of output.split('\n')) {
    const [sha, ref] = line.split('\t');
    if (!sha || !ref?.startsWith('refs/tags/')) {
      continue;
    }
    const name = ref.slice('refs/tags/'.length);
    if (name.endsWith('^{}')) {
      peeled.set(name.slice(0, -'^{}'.length), sha);
    } else {
      lightweight.set(name, sha);
    }
  }
  return [...new Set([...peeled.keys(), ...lightweight.keys()])].flatMap((name) => {
    const sha = peeled.get(name) ?? lightweight.get(name);
    return sha ? [{ name, sha }] : [];
  });
}

type VersionKey = [number, number, number];

function semverKey(name: string): VersionKey | undefined {
  const match = name.match(SEMVER_RE);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

function majorKey(name: string): VersionKey | undefined {
  const match = name.match(MAJOR_RE);
  return match ? [Number(match[1]), 0, 0] : undefined;
}

function compareKeys(a: VersionKey, b: VersionKey): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function newest(
  tags: RemoteTag[],
  keyOf: (name: string) => VersionKey | undefined,
  preferV: boolean,
): RemoteTag | undefined {
  let best: VersionKey | undefined;
  let group: RemoteTag[] = [];
  for (const tag of tags) {
    const key = keyOf(tag.name);
    if (!key) {
      continue;
    }
    const order = best ? compareKeys(key, best) : 1;
    if (order > 0) {
      best = key;
      group = [tag];
    } else if (order === 0) {
      group.push(tag);
    }
  }
  return group.find((tag) => tag.name.startsWith('v') === preferV) ?? group[0];
}

/** `undefined` when the pin is floating, owned elsewhere, or already current. */
export function nextPin(
  version: string,
  suffix: string,
  tags: RemoteTag[],
): { version: string; suffix: string } | undefined {
  if (SHA_RE.test(version)) {
    const commented = suffix.match(/v?\d+\.\d+\.\d+/);
    if (!commented) {
      return;
    }
    const latest = newest(tags, semverKey, commented[0].startsWith('v'));
    if (!latest) {
      return;
    }
    const nextSuffix = suffix.replace(commented[0], latest.name);
    if (latest.sha.toLowerCase() === version.toLowerCase() && nextSuffix === suffix) {
      return;
    }
    return { version: latest.sha, suffix: nextSuffix };
  }
  if (MAJOR_RE.test(version)) {
    const latest = newest(tags, majorKey, version.startsWith('v'));
    if (!latest || latest.name === version) {
      return;
    }
    return { version: latest.name, suffix };
  }
  if (SEMVER_RE.test(version)) {
    const latest = newest(tags, semverKey, version.startsWith('v'));
    if (!latest || latest.name === version) {
      return;
    }
    return { version: latest.name, suffix };
  }
  return;
}

function shownVersion(version: string, suffix: string): string {
  if (SHA_RE.test(version)) {
    return suffix.match(/v?\d+\.\d+\.\d+/)?.[0] ?? version.slice(0, 12);
  }
  return version;
}

export function planLine(line: string, tagsFor: (repo: string) => RemoteTag[]): { line: string; change?: PinChange } {
  if (line.trimStart().startsWith('#')) {
    return { line };
  }
  const match = line.match(/^(\s*-?\s*)uses:\s*(\S+)(.*)$/);
  if (!match) {
    return { line };
  }
  const quote = match[2].length > 1 && (match[2].startsWith('"') || match[2].startsWith("'")) ? match[2][0] : '';
  const token = quote && match[2].endsWith(quote) ? match[2].slice(1, -1) : match[2];
  const action = parseActionUse(token);
  if (!action || action.repo === RELEASEKIT_REPO) {
    return { line };
  }
  const next = nextPin(action.version, match[3], tagsFor(action.repo));
  if (!next) {
    return { line };
  }
  const from = shownVersion(action.version, match[3]);
  const to = shownVersion(next.version, next.suffix);
  const label = action.subpath ? `${action.repo}/${action.subpath}` : action.repo;
  return {
    line: `${match[1]}uses: ${quote}${formatActionUse(action, next.version)}${quote}${next.suffix}`,
    change: { label, from, to, major: majorOf(from) !== majorOf(to) },
  };
}

function majorOf(version: string): number | undefined {
  const match = version.match(/v?(\d+)/);
  return match ? Number(match[1]) : undefined;
}

export function updateSource(
  content: string,
  tagsFor: (repo: string) => RemoteTag[],
): { content: string; changes: PinChange[] } {
  const changes: PinChange[] = [];
  const lines = content.split('\n').map((line) => {
    const planned = planLine(line, tagsFor);
    if (planned.change) {
      changes.push(planned.change);
    }
    return planned.line;
  });
  return { content: lines.join('\n'), changes };
}

export function isUpdateTarget(rel: string): boolean {
  const parts = rel.split(/[/\\]/);
  if (parts.some((part) => SKIP_DIRS.has(part))) {
    return false;
  }
  const base = parts.at(-1) ?? '';
  if (base === 'CHANGELOG.md') {
    return false;
  }
  if (parts[0] === '.github') {
    return base.endsWith('.yml') || base.endsWith('.yaml') || base.endsWith('.md');
  }
  return base.endsWith('.md');
}

export function filesToUpdate(repoRoot: string): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (isUpdateTarget(relative(repoRoot, path))) {
        files.push(path);
      }
    }
  };
  walk(repoRoot);
  return files;
}

export function summarize(changes: PinChange[]): string[] {
  const grouped = new Map<string, { count: number; major: boolean }>();
  for (const change of changes) {
    const key = `${change.label} ${change.from} → ${change.to}`;
    const entry = grouped.get(key) ?? { count: 0, major: false };
    entry.count += 1;
    entry.major ||= change.major;
    grouped.set(key, entry);
  }
  return [...grouped].map(([key, entry]) => `${key}${entry.major ? ' (major)' : ''} (${entry.count})`);
}

function fetchTags(repo: string): RemoteTag[] {
  const output = execFileSync('git', ['ls-remote', '--tags', `https://github.com/${repo}.git`], { encoding: 'utf8' });
  return parseLsRemoteTags(output);
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const cache = new Map<string, RemoteTag[]>();
  const tagsFor = (repo: string) => {
    const cached = cache.get(repo);
    if (cached) {
      return cached;
    }
    const tags = fetchTags(repo);
    cache.set(repo, tags);
    return tags;
  };

  const changes: PinChange[] = [];
  for (const file of filesToUpdate(root)) {
    const updated = updateSource(readFileSync(file, 'utf8'), tagsFor);
    if (updated.changes.length === 0) {
      continue;
    }
    changes.push(...updated.changes);
    if (!dryRun) {
      writeFileSync(file, updated.content);
    }
  }

  if (changes.length === 0) {
    console.log('Action pins are current.');
    return;
  }
  for (const line of summarize(changes)) {
    console.log(line);
  }
  if (dryRun) {
    console.log('Dry run; no files written.');
  }
}

if (import.meta.main) {
  main();
}
