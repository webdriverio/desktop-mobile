#!/usr/bin/env node

// Dependabot closes a cargo PR once main's lockfiles contain the bump, so refresh every lock it watches.

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
  return directories.map((directory) => directory.replace(/^\//, ''));
}

function main() {
  for (const dir of cargoDirectories(readFileSync(join(root, '.github/dependabot.yml'), 'utf8'))) {
    console.log(`📝 cargo update in ${dir}`);
    execSync('cargo update', { cwd: join(root, dir), stdio: 'inherit' });
  }
}

if (import.meta.main) {
  main();
}
