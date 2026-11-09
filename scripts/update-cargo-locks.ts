#!/usr/bin/env node

// Dependabot closes a cargo PR once main's lockfiles contain the bump, so refresh every committed lock.

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const locks = execFileSync('git', ['ls-files', '*Cargo.lock'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

for (const lock of locks) {
  const dir = dirname(lock);
  console.log(`📝 cargo update in ${dir}`);
  execFileSync('cargo', ['update'], { cwd: join(root, dir), stdio: 'inherit' });
}
