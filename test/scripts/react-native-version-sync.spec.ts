import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const REPO_ROOT = new URL('../../', import.meta.url);

// The React Native e2e fixture is never installed. CI scaffolds a fresh app with
// `@react-native-community/cli init` at the workflow's `rn-version` input and overlays only
// the fixture's App.tsx, so `fixtures/e2e-apps/react-native/package.json` documents the
// scaffolded app rather than driving it. Nothing else ties the two together, so without this
// guard a dependency sweep could move the fixture off the version CI actually builds and the
// file would keep reading as authoritative. `rn-cli-version` must move with it — the CLI major
// is pinned to the RN version so an unpinned @latest can't break scaffolding.
const WORKFLOWS = [
  '.github/workflows/_ci-e2e-react-native.reusable.yml',
  '.github/workflows/_ci-e2e-react-native-ios.reusable.yml',
  '.github/workflows/_ci-build-react-native-ios-app.reusable.yml',
];

function workflowCallInputs(file: string): Record<string, { default?: string }> {
  const doc = parse(readFileSync(new URL(file, REPO_ROOT), 'utf8'));
  // YAML 1.1 would fold the `on:` key to boolean true; the parser is 1.2, but stay tolerant.
  const on = doc.on ?? doc[true as unknown as string];
  return on?.workflow_call?.inputs ?? {};
}

const declared = WORKFLOWS.map((file) => ({ file, inputs: workflowCallInputs(file) }));

const fixture = JSON.parse(readFileSync(new URL('fixtures/e2e-apps/react-native/package.json', REPO_ROOT), 'utf8')) as {
  dependencies: Record<string, string>;
};

/** `[file → value]` pairs, so a mismatch names the offending workflow rather than just failing. */
const pinsFor = (input: string) => declared.map(({ file, inputs }) => `${file} → ${inputs[input]?.default}`);

describe('React Native fixture ↔ workflow version sync', () => {
  it('should pin the same rn-version in every React Native workflow', () => {
    expect(new Set(pinsFor('rn-version').map((p) => p.split(' → ')[1])).size, pinsFor('rn-version').join('\n')).toBe(1);
  });

  it('should pin the same rn-cli-version in every React Native workflow', () => {
    const pins = pinsFor('rn-cli-version');
    expect(new Set(pins.map((p) => p.split(' → ')[1])).size, pins.join('\n')).toBe(1);
  });

  it('should match the fixture react-native version to the scaffolded rn-version', () => {
    const scaffolded = declared[0].inputs['rn-version']?.default;
    expect(scaffolded).toBeDefined();
    expect(
      fixture.dependencies['react-native'].replace(/^[\^~]/, ''),
      'fixtures/e2e-apps/react-native/package.json documents the app CI scaffolds — bump it with rn-version',
    ).toBe(scaffolded);
  });
});
