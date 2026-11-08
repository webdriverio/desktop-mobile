import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isUpdateTarget,
  nextPin,
  parseLsRemoteTags,
  planLine,
  type RemoteTag,
  summarize,
  updateSource,
} from '../../scripts/update-actions.ts';

const binstall: RemoteTag[] = [
  { name: 'v1.25.3', sha: 'a'.repeat(40) },
  { name: 'v1.26.2', sha: 'b'.repeat(40) },
  { name: 'v2.0.0-beta.1', sha: 'c'.repeat(40) },
];
const majors: RemoteTag[] = [
  { name: 'v5', sha: 'd'.repeat(40) },
  { name: 'v6', sha: 'e'.repeat(40) },
  { name: 'v6.1.0', sha: 'f'.repeat(40) },
];
const commits: RemoteTag[] = [
  { name: 'v2.23.0', sha: '1'.repeat(40) },
  { name: 'v2.24.0', sha: '2'.repeat(40) },
];

describe('parseLsRemoteTags', () => {
  it('should keep the peeled commit for an annotated tag', () => {
    const output = ['abc\trefs/tags/v1.0.0', 'def\trefs/tags/v1.0.0^{}', 'aaa\trefs/tags/v1.1.0'].join('\n');
    expect(parseLsRemoteTags(output)).toEqual([
      { name: 'v1.0.0', sha: 'def' },
      { name: 'v1.1.0', sha: 'aaa' },
    ]);
  });
});

describe('nextPin', () => {
  it('should advance a semver pin to the newest stable tag', () => {
    expect(nextPin('v1.25.3', '', binstall)).toEqual({ version: 'v1.26.2', suffix: '' });
  });

  it('should ignore a prerelease tag', () => {
    expect(nextPin('v1.26.2', '', binstall)).toBeUndefined();
  });

  it('should cross a major when the newest stable tag is a new major', () => {
    const withMajor = [...binstall, { name: 'v2.0.0', sha: '9'.repeat(40) }];
    expect(nextPin('v1.26.2', '', withMajor)?.version).toBe('v2.0.0');
  });

  it('should move a major pin to the newest major tag', () => {
    expect(nextPin('v5', '', majors)?.version).toBe('v6');
  });

  it('should not turn a major pin into a patch pin', () => {
    expect(nextPin('v6', '', majors)).toBeUndefined();
  });

  it('should leave a floating ref', () => {
    expect(nextPin('v2.x', '', majors)).toBeUndefined();
    expect(nextPin('stable', '', majors)).toBeUndefined();
  });

  it('should move a commit pin and its version comment together', () => {
    const sha = '0'.repeat(40);
    expect(nextPin(sha, ' # v2.23.0', commits)).toEqual({ version: '2'.repeat(40), suffix: ' # v2.24.0' });
  });

  it('should leave a commit pin that already matches the newest tag', () => {
    expect(nextPin('2'.repeat(40), ' # v2.24.0', commits)).toBeUndefined();
  });

  it('should leave a commit pin with no version comment', () => {
    expect(nextPin('0'.repeat(40), '', commits)).toBeUndefined();
  });
});

describe('planLine', () => {
  it('should rewrite a workflow pin, including a subpath', () => {
    const planned = planLine('        uses: actions/cache/save@v5', () => majors);
    expect(planned.line).toBe('        uses: actions/cache/save@v6');
    expect(planned.change).toMatchObject({ label: 'actions/cache/save', from: 'v5', to: 'v6', major: true });
  });

  it('should keep the releasekit pin for update:releasekit', () => {
    const line = '        uses: goosewobbler/releasekit@v0.43.0';
    expect(planLine(line, () => [{ name: 'v0.44.0', sha: 'a'.repeat(40) }])).toEqual({ line });
  });

  it('should ignore a commented example and a local workflow', () => {
    expect(planLine('      #   uses: actions/setup-example@v1', () => majors).change).toBeUndefined();
    expect(planLine('    uses: ./.github/workflows/_ci-build.reusable.yml', () => majors).change).toBeUndefined();
  });

  it('should keep surrounding quotes', () => {
    expect(planLine('uses: "cargo-bins/cargo-binstall@v1.25.3"', () => binstall).line).toBe(
      'uses: "cargo-bins/cargo-binstall@v1.26.2"',
    );
  });
});

describe('updateSource', () => {
  it('should count one grouped bump per pin', () => {
    const content = ['uses: cargo-bins/cargo-binstall@v1.25.3', 'uses: cargo-bins/cargo-binstall@v1.25.3', ''].join(
      '\n',
    );
    const updated = updateSource(content, () => binstall);
    expect(updated.content).toContain('v1.26.2');
    expect(summarize(updated.changes)).toEqual(['cargo-bins/cargo-binstall v1.25.3 → v1.26.2 (2)']);
  });
});

describe('isUpdateTarget', () => {
  it('should cover workflow files, composite actions, and docs, not changelogs or build output', () => {
    expect(isUpdateTarget('.github/workflows/ci.yml')).toBe(true);
    expect(isUpdateTarget('.github/workflows/actions/setup-workspace/action.yml')).toBe(true);
    expect(isUpdateTarget('packages/dioxus-service/docs/quick-start.md')).toBe(true);
    expect(isUpdateTarget('packages/dioxus-service/CHANGELOG.md')).toBe(false);
    expect(isUpdateTarget('packages/dioxus-bridge/target/package/readme.md')).toBe(false);
  });
});

describe('package scripts', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    scripts: Record<string, string>;
  };

  it('should run action pins only from update:actions and update:all', () => {
    expect(pkg.scripts['update:actions']).toBe('node ./scripts/update-actions.ts');
    expect(pkg.scripts['update:all']).toBe('pnpm update:dependencies && pnpm update:actions');
    expect(pkg.scripts['update:dependencies']).not.toContain('update:actions');
  });
});
