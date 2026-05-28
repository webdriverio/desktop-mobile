#!/usr/bin/env tsx
import { mkdirSync, rmSync } from 'node:fs';

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error('Usage: clean-dist.ts <path-to-remove> [<path-to-remove>...]');
  process.exit(1);
}

for (const target of targets) {
  rmSync(target, { recursive: true, force: true });
}
mkdirSync('./dist', { recursive: true });
