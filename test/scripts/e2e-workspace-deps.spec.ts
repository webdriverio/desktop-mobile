import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = new URL('../../', import.meta.url);
const readJson = (path: string) => JSON.parse(readFileSync(new URL(path, REPO_ROOT), 'utf8'));

const workspacePackages = new Set(
  readdirSync(new URL('packages/', REPO_ROOT))
    .filter((dir) => existsSync(new URL(`packages/${dir}/package.json`, REPO_ROOT)))
    .map((dir) => readJson(`packages/${dir}/package.json`).name),
);

// Turbo skips a link: dep in ^build and the task hashes, and pnpm installs a version spec from npm.
describe('e2e/package.json', () => {
  it('should depend on workspace packages with workspace:', () => {
    const e2e = readJson('e2e/package.json');
    const offending = Object.entries<string>({ ...e2e.dependencies, ...e2e.devDependencies })
      .filter(([name, spec]) => workspacePackages.has(name) && !spec.startsWith('workspace:'))
      .map(([name, spec]) => `${name}: ${spec}`);
    expect(offending).toEqual([]);
  });
});
