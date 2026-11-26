#!/usr/bin/env node

import { execSync } from 'node:child_process';
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

function updateWorkflowFile(path: string, version: string) {
  const content = readFileSync(path, 'utf8');
  const updated = content.replace(/goosewobbler\/releasekit@v[\d.]+/g, `goosewobbler/releasekit@v${version}`);

  if (content === updated) {
    console.log(`  - ${path.replace(`${ROOT}/`, '')}: no occurrences found`);
    return;
  }

  writeFileSync(path, updated);
  const count = (updated.match(/goosewobbler\/releasekit@v[\d.]+/g) ?? []).length;
  console.log(`  ✓ ${path.replace(`${ROOT}/`, '')}: ${count} occurrence(s) → v${version}`);
}

function runCommand(command: string, cwd: string) {
  execSync(command, { cwd, stdio: 'inherit' });
}

function main() {
  console.log('\n📡 Fetching latest @releasekit/release version from npm...');
  const version = fetchLatestVersion();
  console.log(`   Latest: v${version}\n`);

  console.log(`🔧 Updating releasekit to v${version}\n`);

  for (const file of WORKFLOW_FILES) {
    updateWorkflowFile(file, version);
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
