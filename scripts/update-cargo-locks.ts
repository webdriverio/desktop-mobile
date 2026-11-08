#!/usr/bin/env node

// Dependabot closes a cargo PR once main's lockfiles already contain the bump. update:tauri only
// runs `cargo update` in the two Tauri fixtures, so the other locks it watches stay behind.

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

interface DependabotUpdate {
  'package-ecosystem'?: string;
  directories?: string[];
}

export function cargoDirectories(dependabotYaml: string): string[] {
  const doc = parse(dependabotYaml) as { updates?: DependabotUpdate[] };
  const directories = (doc.updates ?? [])
    .filter((update) => update['package-ecosystem'] === 'cargo')
    .flatMap((update) => update.directories ?? []);
  if (directories.length === 0) {
    throw new Error('dependabot.yml has no cargo directories');
  }
  return directories.map((directory) => {
    const relative = directory.replace(/^\//, '');
    if (relative === '' || relative.split('/').includes('..')) {
      throw new Error(`Unexpected cargo directory '${directory}'`);
    }
    return relative;
  });
}

function updateCargoLocks(repoRoot: string, run: (dir: string) => void): string[] {
  const dirs = cargoDirectories(readFileSync(join(repoRoot, '.github/dependabot.yml'), 'utf8'));
  for (const dir of dirs) {
    if (!existsSync(join(repoRoot, dir, 'Cargo.lock'))) {
      throw new Error(`${dir} is in dependabot.yml but has no Cargo.lock`);
    }
    run(dir);
  }
  return dirs;
}

function main() {
  updateCargoLocks(root, (dir) => {
    console.log(`📝 cargo update in ${dir}`);
    execSync('cargo update', { cwd: join(root, dir), stdio: 'inherit' });
  });
}

if (import.meta.main) {
  main();
}
