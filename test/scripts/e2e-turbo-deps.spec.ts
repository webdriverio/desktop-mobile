import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, REPO_ROOT), 'utf8');

// Turbo doesn't treat link: deps as workspace deps, so ^build skips them and their changes miss the task hash.
const e2ePackage = JSON.parse(read('e2e/package.json'));
const linkedBuilds = Object.entries<string>({ ...e2ePackage.dependencies, ...e2ePackage.devDependencies })
  .filter(([, spec]) => spec.startsWith('link:'))
  .map(([name]) => `${name}#build`)
  .sort();

const turbo = ts.parseConfigFileTextToJson('turbo.json', read('turbo.json')).config;

describe('@repo/e2e#typecheck', () => {
  it('should depend on the build of every package e2e links', () => {
    expect(turbo.tasks['@repo/e2e#typecheck'].dependsOn).toEqual(expect.arrayContaining(linkedBuilds));
  });
});
