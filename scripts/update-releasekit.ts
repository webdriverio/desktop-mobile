#!/usr/bin/env node

import { execFileSync, execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

const WORKFLOW_FILES = [
  join(ROOT, '.github/workflows/_release.reusable.yml'),
  join(ROOT, '.github/workflows/_standing-pr-update.reusable.yml'),
  join(ROOT, '.github/workflows/release-preview.yml'),
  join(ROOT, '.github/workflows/release.yml'),
];

function fetchLatestVersion(): string {
  const output = execSync('npm view @releasekit/release version', { encoding: 'utf8' });
  return output.trim();
}

const RELEASEKIT_REF = /goosewobbler\/releasekit@[0-9a-f]{40} # v[\d.]+/g;

function resolveTagCommit(version: string): string {
  const tag = `refs/tags/v${version}`;
  // An annotated tag's own SHA isn't a commit; `^{}` names the commit it points to.
  const output = execFileSync('git', ['ls-remote', 'https://github.com/goosewobbler/releasekit', tag, `${tag}^{}`], {
    encoding: 'utf8',
  });
  const refs = new Map(
    output
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => line.split('\t').reverse() as [string, string]),
  );
  const sha = refs.get(`${tag}^{}`) ?? refs.get(tag);
  if (!sha) {
    throw new Error(`goosewobbler/releasekit has no tag v${version}`);
  }
  return sha;
}

function updateWorkflowFile(path: string, version: string, sha: string) {
  const content = readFileSync(path, 'utf8');
  const count = (content.match(RELEASEKIT_REF) ?? []).length;
  const name = path.replace(`${ROOT}/`, '');
  if (count === 0) {
    console.log(`  - ${name}: no occurrences found`);
    return;
  }

  const updated = content.replace(RELEASEKIT_REF, `goosewobbler/releasekit@${sha} # v${version}`);
  if (updated === content) {
    console.log(`  - ${name}: already at v${version}`);
    return;
  }
  writeFileSync(path, updated);
  console.log(`  ✓ ${name}: ${count} occurrence(s) → v${version}`);
}

function runCommand(command: string, cwd: string) {
  execSync(command, { cwd, stdio: 'inherit' });
}

function main() {
  console.log('\n📡 Fetching latest @releasekit/release version from npm...');
  const version = fetchLatestVersion();
  console.log(`   Latest: v${version}\n`);

  const sha = resolveTagCommit(version);
  console.log(`🔧 Updating releasekit to v${version} (${sha})\n`);

  for (const file of WORKFLOW_FILES) {
    updateWorkflowFile(file, version, sha);
  }

  // `pnpm install` doesn't prune minimumReleaseAgeExclude; `pnpm add` does.
  console.log(`\n📦 Installing @releasekit/release@^${version}...`);
  runCommand(`pnpm add --save-dev --workspace-root @releasekit/release@^${version}`, ROOT);

  console.log('\n📌 Staging changes...');
  const changedFiles = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', ...WORKFLOW_FILES];
  runCommand(`git add ${changedFiles.map((file) => `"${file}"`).join(' ')}`, ROOT);

  console.log(`\n✅ Done — releasekit updated to v${version}`);
}

main();
