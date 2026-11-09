#!/usr/bin/env node

// Moves third-party `uses:` pins to the newest tag, which is what closes Dependabot's
// github-actions PRs. releasekit stays with update:releasekit.
// Commit pins guard jobs with secret access, so they are reported for a manual bump, never moved.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const RELEASEKIT_REPO = 'goosewobbler/releasekit';
const SHA_RE = /^[0-9a-f]{40}$/i;
const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)$/;
const MAJOR_RE = /^v?(\d+)$/;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

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

export function parseLsRemoteTags(output: string): string[] {
  return output.split('\n').flatMap((line) => {
    const ref = line.split('\t')[1];
    return ref?.startsWith('refs/tags/') ? [ref.slice('refs/tags/'.length)] : [];
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

function keyFor(version: string): ((name: string) => VersionKey | undefined) | undefined {
  return MAJOR_RE.test(version) ? majorKey : SEMVER_RE.test(version) ? semverKey : undefined;
}

// Only a strictly newer tag in the pin's own `v` scheme counts, so a missing tag or a stray date tag never moves a pin.
function newerTag(
  current: string,
  tags: string[],
  keyOf: (name: string) => VersionKey | undefined,
): string | undefined {
  const prefixed = current.startsWith('v');
  let best = keyOf(current);
  if (!best) {
    return;
  }
  let newer: string | undefined;
  for (const tag of tags) {
    const key = tag.startsWith('v') === prefixed ? keyOf(tag) : undefined;
    if (key && compareKeys(key, best) > 0) {
      best = key;
      newer = tag;
    }
  }
  return newer;
}

export function nextPin(version: string, tags: string[]): string | undefined {
  const keyOf = keyFor(version);
  return keyOf ? newerTag(version, tags, keyOf) : undefined;
}

export function planLine(
  line: string,
  tagsFor: (repo: string) => string[],
): { line: string; change?: PinChange; held?: PinChange } {
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
  const label = action.subpath ? `${action.repo}/${action.subpath}` : action.repo;
  if (SHA_RE.test(action.version)) {
    const from = match[3].match(/v?\d+\.\d+\.\d+/)?.[0];
    const to = from && newerTag(from, tagsFor(action.repo), semverKey);
    return from && to ? { line, held: { label, from, to, major: majorOf(from) !== majorOf(to) } } : { line };
  }
  if (!keyFor(action.version)) {
    return { line };
  }
  const next = nextPin(action.version, tagsFor(action.repo));
  if (!next) {
    return { line };
  }
  return {
    line: `${match[1]}uses: ${quote}${formatActionUse(action, next)}${quote}${match[3]}`,
    change: { label, from: action.version, to: next, major: majorOf(action.version) !== majorOf(next) },
  };
}

function majorOf(version: string): number | undefined {
  const match = version.match(/v?(\d+)/);
  return match ? Number(match[1]) : undefined;
}

export function updateSource(
  content: string,
  tagsFor: (repo: string) => string[],
): { content: string; changes: PinChange[]; held: PinChange[] } {
  const changes: PinChange[] = [];
  const held: PinChange[] = [];
  const lines = content.split('\n').map((line) => {
    const planned = planLine(line, tagsFor);
    if (planned.change) {
      changes.push(planned.change);
    }
    if (planned.held) {
      held.push(planned.held);
    }
    return planned.line;
  });
  return { content: lines.join('\n'), changes, held };
}

export function isUpdateTarget(rel: string): boolean {
  const base = rel.split('/').at(-1) ?? '';
  if (base === 'CHANGELOG.md') {
    return false;
  }
  return base.endsWith('.md') || (rel.startsWith('.github/') && /\.ya?ml$/.test(base));
}

// Tracked files only, so ignored worktrees and untracked notes are never rewritten.
export function filesToUpdate(repoRoot: string): string[] {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' });
  return tracked
    .split('\0')
    .filter((rel) => rel && isUpdateTarget(rel))
    .map((rel) => join(repoRoot, rel));
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

function fetchTags(repo: string): string[] {
  // Fail on a missing or private repo instead of waiting at a credential prompt.
  const output = execFileSync('git', ['ls-remote', '--tags', '--refs', `https://github.com/${repo}.git`], {
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return parseLsRemoteTags(output);
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const cache = new Map<string, string[]>();
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
  const held: PinChange[] = [];
  for (const file of filesToUpdate(root)) {
    const updated = updateSource(readFileSync(file, 'utf8'), tagsFor);
    held.push(...updated.held);
    if (updated.changes.length === 0) {
      continue;
    }
    changes.push(...updated.changes);
    if (!dryRun) {
      writeFileSync(file, updated.content);
    }
  }

  if (changes.length === 0 && held.length === 0) {
    console.log('Action pins are current.');
    return;
  }
  for (const line of summarize(changes)) {
    console.log(line);
  }
  if (held.length > 0) {
    console.log('Pinned by commit, so not moved. Bump these by hand:');
    for (const line of summarize(held)) {
      console.log(`  ${line}`);
    }
  }
  if (dryRun && changes.length > 0) {
    console.log('Dry run; no files written.');
  }
}

if (import.meta.main) {
  main();
}
