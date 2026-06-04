import { describe, expect, it } from 'vitest';
import { classifyChanges, classifyFile, discoverServices } from '../../scripts/detect-changes.mjs';

const SERVICES = ['dioxus', 'electrobun', 'electron', 'tauri'];

function decide(files: string[], forceAll = false) {
  return classifyChanges(files, SERVICES, { forceAll });
}

describe('discoverServices', () => {
  it('should derive the service list from packages/*-service', () => {
    expect(discoverServices(new URL('../..', import.meta.url).pathname)).toEqual(SERVICES);
  });
});

describe('classifyFile', () => {
  it.each([
    // docs anywhere → none
    ['README.md', 'none'],
    ['packages/electron-service/README.md', 'none'],
    ['packages/dioxus-bridge/docs/release-notes/v1.0.0.md', 'none'],
    ['.claude/skills/add-native-service/SKILL.md', 'none'],
    ['agent-os/specs/foo/spec.md', 'none'],
    // packages → service / shared / unknown→all
    ['packages/electron-service/src/session.ts', 'electron'],
    ['packages/electron-cdp-bridge/src/bridge.ts', 'electron'],
    ['packages/electrobun-cdp-bridge/src/connection.ts', 'electrobun'],
    ['packages/tauri-plugin/src/index.ts', 'tauri'],
    ['packages/tauri-plugin-webdriver/Cargo.toml', 'tauri'],
    ['packages/dioxus-bridge/src/lib.rs', 'dioxus'],
    ['packages/dioxus-embedded-driver/src/lib.rs', 'dioxus'],
    ['packages/native-utils/src/teardown.ts', 'shared'],
    ['packages/native-core/src/index.ts', 'shared'],
    ['packages/bundler/src/index.ts', 'shared'],
    ['packages/some-new-thing/src/index.ts', 'unknown'],
    // e2e
    ['e2e/test/electron/api.spec.ts', 'electron'],
    ['e2e/wdio.electron.conf.ts', 'electron'],
    ['e2e/wdio.dioxus-embedded.conf.ts', 'dioxus'],
    ['e2e/package.json', 'all'],
    ['e2e/test/helpers/shared.ts', 'all'],
    // fixtures
    ['fixtures/e2e-apps/electron-builder/package.json', 'electron'],
    ['fixtures/e2e-apps/tauri/src-tauri/Cargo.toml', 'tauri'],
    ['fixtures/package-tests/dioxus-app/docker/test.sh', 'dioxus'],
    ['fixtures/package-tests/electrobun-app/wdio.conf.ts', 'electrobun'],
    ['fixtures/e2e-apps/mystery/app.ts', 'unknown'],
    // workflows
    ['.github/workflows/ci.yml', 'all'],
    ['.github/workflows/_ci-detect-changes.reusable.yml', 'all'],
    ['.github/workflows/_release.reusable.yml', 'all'],
    ['.github/workflows/actions/setup-workspace/action.yml', 'all'],
    ['.github/workflows/_ci-e2e-electron.reusable.yml', 'electron'],
    ['.github/workflows/_ci-package-docker-tauri.reusable.yml', 'tauri'],
    ['.github/workflows/_ci-package-docker-dioxus.reusable.yml', 'dioxus'],
    ['.github/workflows/_ci-build-electrobun-e2e-app.reusable.yml', 'electrobun'],
    ['.github/workflows/_ci-build-electron-package-apps.reusable.yml', 'electron'],
    ['.github/workflows/codeql.yml', 'none'],
    ['.github/workflows/release-preview.yml', 'none'],
    ['.github/workflows/some-future-workflow.yml', 'unknown'],
    ['.github/codeql/artifact-poisoning-analysis.json', 'none'],
    // scripts
    ['scripts/update-tauri-version.ts', 'tauri'],
    ['scripts/test-package.ts', 'all'],
    ['scripts/detect-changes.mjs', 'all'],
    // root config
    ['package.json', 'all'],
    ['pnpm-lock.yaml', 'all'],
    ['tsconfig.base.json', 'all'],
    ['turbo.json', 'all'],
    ['biome.jsonc', 'none'],
    ['eslint.config.js', 'none'],
    ['.gitignore', 'none'],
    ['LICENSE', 'none'],
    // electron vs electrobun token boundaries
    ['.github/workflows/_ci-e2e-electrobun-all-providers.reusable.yml', 'electrobun'],
  ])('should classify %s as %s', (file, expected) => {
    expect(classifyFile(file, SERVICES)).toBe(expected);
  });
});

describe('classifyChanges decisions', () => {
  it('should run lint-only for a docs-only PR (root + package README)', () => {
    const d = decide(['README.md', 'packages/electron-service/README.md']);
    expect(d.lintOnly).toBe(true);
    expect(Object.values(d.runs).every((v) => v === false)).toBe(true);
  });

  it('should run only electron for an electron src change', () => {
    const d = decide(['packages/electron-service/src/session.ts']);
    expect(d.runs).toEqual({ dioxus: false, electrobun: false, electron: true, tauri: false });
    expect(d.lintOnly).toBe(false);
  });

  it('should run only tauri for the tauri-only script', () => {
    const d = decide(['scripts/update-tauri-version.ts']);
    expect(d.runs).toEqual({ dioxus: false, electrobun: false, electron: false, tauri: true });
  });

  it('should run everything for a cross-service script', () => {
    const d = decide(['scripts/test-package.ts']);
    expect(Object.values(d.runs).every(Boolean)).toBe(true);
    expect(d.triggersAll).toEqual(['scripts/test-package.ts']);
  });

  it('should run everything and flag shared for a shared package change', () => {
    const d = decide(['packages/native-utils/src/teardown.ts']);
    expect(Object.values(d.runs).every(Boolean)).toBe(true);
    expect(d.sharedChanges).toBe(true);
    expect(d.triggersAll).toEqual([]);
  });

  it('should run only electron for mixed md + electron src, not lint-only', () => {
    const d = decide(['README.md', 'packages/electron-service/src/x.ts']);
    expect(d.runs.electron).toBe(true);
    expect(d.runs.tauri).toBe(false);
    expect(d.lintOnly).toBe(false);
  });

  it('should run everything when force-all is set', () => {
    const d = decide(['README.md'], true);
    expect(Object.values(d.runs).every(Boolean)).toBe(true);
    expect(d.lintOnly).toBe(false);
  });

  it('should run lint-only when no files changed', () => {
    const d = decide([]);
    expect(d.lintOnly).toBe(true);
  });

  it('should classify a hypothetical new service once its package exists', () => {
    const services = [...SERVICES, 'neutralino'];
    const d = classifyChanges(['packages/neutralino-service/src/launcher.ts'], services);
    expect(d.runs.neutralino).toBe(true);
    expect(d.runs.electron).toBe(false);
  });

  it('should separate deliberate run-alls from unclassified drift', () => {
    const d = decide(['scripts/test-package.ts', 'packages/some-new-thing/src/index.ts']);
    expect(Object.values(d.runs).every(Boolean)).toBe(true);
    expect(d.triggersAll).toEqual(['scripts/test-package.ts']);
    expect(d.unknownFiles).toEqual(['packages/some-new-thing/src/index.ts']);
  });
});
