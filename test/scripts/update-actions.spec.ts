import { describe, expect, it } from 'vitest';
import {
  isUpdateTarget,
  nextPin,
  parseLsRemoteTags,
  planLine,
  summarize,
  updateSource,
} from '../../scripts/update-actions.ts';

const binstall = ['v1.25.3', 'v1.26.2', 'v2.0.0-beta.1'];
const majors = ['v5', 'v6', 'v6.1.0'];
const commits = ['v2.23.0', 'v2.24.0'];

describe('parseLsRemoteTags', () => {
  it('should list tag names and skip other refs', () => {
    const output = ['abc\trefs/tags/v1.0.0', 'def\trefs/heads/main', 'aaa\trefs/tags/v1.1.0', ''].join('\n');
    expect(parseLsRemoteTags(output)).toEqual(['v1.0.0', 'v1.1.0']);
  });
});

describe('nextPin', () => {
  it('should advance a semver pin to the newest stable tag', () => {
    expect(nextPin('v1.25.3', binstall)).toBe('v1.26.2');
  });

  it('should ignore a prerelease tag', () => {
    expect(nextPin('v1.26.2', binstall)).toBeUndefined();
  });

  it('should cross a major when the newest stable tag is a new major', () => {
    const withMajor = [...binstall, 'v2.0.0'];
    expect(nextPin('v1.26.2', withMajor)).toBe('v2.0.0');
  });

  it('should move a major pin to the newest major tag', () => {
    expect(nextPin('v5', majors)).toBe('v6');
  });

  it('should not turn a major pin into a patch pin', () => {
    expect(nextPin('v6', majors)).toBeUndefined();
  });

  it('should never move a pin to an older tag', () => {
    expect(nextPin('v7', majors)).toBeUndefined();
  });

  it('should stay within the v or bare tag scheme of the pin', () => {
    expect(nextPin('v5', [...majors, '2024'])).toBe('v6');
  });

  it('should leave a floating ref', () => {
    expect(nextPin('v2.x', majors)).toBeUndefined();
    expect(nextPin('stable', majors)).toBeUndefined();
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
    expect(planLine(line, () => ['v0.44.0'])).toEqual({ line });
  });

  it('should ignore a commented example and a local workflow', () => {
    expect(planLine('      #   uses: actions/setup-example@v1', () => majors).change).toBeUndefined();
    expect(planLine('    uses: ./.github/workflows/_ci-build.reusable.yml', () => majors).change).toBeUndefined();
  });

  it('should leave a commit pin', () => {
    const line = `        uses: subosito/flutter-action@${'a'.repeat(40)} # v2.23.0`;
    expect(planLine(line, () => commits)).toEqual({ line });
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
  it('should cover workflow files, composite actions, and docs, not changelogs', () => {
    expect(isUpdateTarget('.github/workflows/ci.yml')).toBe(true);
    expect(isUpdateTarget('.github/workflows/actions/setup-workspace/action.yml')).toBe(true);
    expect(isUpdateTarget('packages/dioxus-service/docs/quick-start.md')).toBe(true);
    expect(isUpdateTarget('packages/dioxus-service/CHANGELOG.md')).toBe(false);
    expect(isUpdateTarget('e2e/wdio.conf.yml')).toBe(false);
  });
});
