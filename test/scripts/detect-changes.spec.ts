import { describe, expect, it } from 'vitest';
import {
  buildServiceDependents,
  classifyChanges,
  classifyFile,
  discoverServices,
} from '../../scripts/detect-changes.ts';

const SERVICES = ['dioxus', 'electrobun', 'electron', 'flutter', 'react-native', 'tauri'];
const REPO_ROOT = new URL('../..', import.meta.url).pathname;
// Use the REAL workspace dependency graph so the narrowing tests reflect production exactly (and
// double as a guard: if a service's native-* deps change, the asserted closures below shift).
const DEPENDENTS = buildServiceDependents(REPO_ROOT, SERVICES);

function decide(files: string[], forceAll = false) {
  return classifyChanges(files, SERVICES, { forceAll, dependents: DEPENDENTS });
}

describe('discoverServices', () => {
  it('should derive the service list from packages/*-service', () => {
    expect(discoverServices(new URL('../..', import.meta.url).pathname)).toEqual(SERVICES);
  });
});

describe('buildServiceDependents', () => {
  it('should map each shared package to the services that transitively depend on it', () => {
    // The narrowing wins: mobile-core is mobile-only; the CDP bridge is electron + electrobun + RN
    // (sorted lexicographically, so 'electrobun' precedes 'electron').
    expect(DEPENDENTS['native-mobile-core']).toEqual(['flutter', 'react-native']);
    expect(DEPENDENTS['native-cdp-bridge']).toEqual(['electrobun', 'electron', 'react-native']);
    // Universally-depended-on packages still map to every service.
    expect(DEPENDENTS['native-utils']).toEqual([...SERVICES].sort());
    expect(DEPENDENTS['native-core']).toEqual([...SERVICES].sort());
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
    ['packages/native-cdp-bridge/src/connection.ts', 'shared'],
    ['packages/tauri-plugin/src/index.ts', 'tauri'],
    ['packages/tauri-plugin-webdriver/Cargo.toml', 'tauri'],
    ['packages/dioxus-bridge/src/lib.rs', 'dioxus'],
    ['packages/dioxus-embedded-driver/src/lib.rs', 'dioxus'],
    ['packages/native-utils/src/teardown.ts', 'shared'],
    ['packages/native-core/src/index.ts', 'shared'],
    ['packages/native-mobile-core/src/launcher.ts', 'shared'],
    ['packages/bundler/src/index.ts', 'shared'],
    // native-types is 'shared' at the file level too — the runtime-dependent narrowing
    // (incl. types-only → no E2E) is applied in classifyChanges, not classifyFile.
    ['packages/native-types/src/react-native.ts', 'shared'],
    ['packages/native-types/src/shared.ts', 'shared'],
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
    // hyphenated service name must match the joined token in workflow filenames (not 'react'/'native')
    ['.github/workflows/_ci-e2e-react-native-ios.reusable.yml', 'react-native'],
    ['.github/workflows/_ci-build-react-native-ios-app.reusable.yml', 'react-native'],
    ['.github/workflows/codeql.yml', 'none'],
    ['.github/workflows/release-preview.yml', 'none'],
    ['.github/workflows/some-future-workflow.yml', 'unknown'],
    ['.github/codeql/artifact-poisoning-analysis.json', 'none'],
    // scripts
    ['scripts/update-tauri-version.ts', 'tauri'],
    ['scripts/test-package.ts', 'all'],
    ['scripts/detect-changes.ts', 'all'],
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
    // react-native: hyphenated service name must match across packages, e2e, fixtures,
    // and (the easy-to-miss case) multi-word workflow filenames.
    ['packages/react-native-service/src/launcher.ts', 'react-native'],
    ['e2e/wdio.react-native.conf.ts', 'react-native'],
    ['e2e/test/react-native/api.spec.ts', 'react-native'],
    ['fixtures/e2e-apps/react-native/App.tsx', 'react-native'],
    ['fixtures/package-tests/react-native-app/wdio.conf.ts', 'react-native'],
    ['.github/workflows/_ci-e2e-react-native-all-providers.reusable.yml', 'react-native'],
    ['.github/workflows/_ci-build-react-native-e2e-app.reusable.yml', 'react-native'],
    // flutter: service src, the wdio_flutter Dart contract (packages/flutter-bridge), e2e, fixtures, workflows.
    ['packages/flutter-service/src/launcher.ts', 'flutter'],
    ['packages/flutter-bridge/lib/wdio_flutter.dart', 'flutter'],
    ['e2e/wdio.flutter.conf.ts', 'flutter'],
    ['e2e/test/flutter/api.spec.ts', 'flutter'],
    ['fixtures/e2e-apps/flutter/lib/main.dart', 'flutter'],
    ['fixtures/package-tests/flutter-app/wdio.conf.ts', 'flutter'],
    ['.github/workflows/_ci-e2e-flutter.reusable.yml', 'flutter'],
    ['.github/workflows/_ci-e2e-flutter-ios.reusable.yml', 'flutter'],
    ['.github/workflows/_ci-build-flutter-ios-app.reusable.yml', 'flutter'],
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
    expect(d.runs).toEqual({
      dioxus: false,
      electrobun: false,
      electron: true,
      flutter: false,
      'react-native': false,
      tauri: false,
    });
    expect(d.lintOnly).toBe(false);
  });

  it('should run only react-native for a react-native src change', () => {
    const d = decide(['packages/react-native-service/src/launcher.ts']);
    expect(d.runs).toEqual({
      dioxus: false,
      electrobun: false,
      electron: false,
      flutter: false,
      'react-native': true,
      tauri: false,
    });
    expect(d.lintOnly).toBe(false);
  });

  it('should run only flutter for a flutter src change', () => {
    const d = decide(['packages/flutter-service/src/launcher.ts']);
    expect(d.runs).toEqual({
      dioxus: false,
      electrobun: false,
      electron: false,
      flutter: true,
      'react-native': false,
      tauri: false,
    });
    expect(d.lintOnly).toBe(false);
  });

  it('should prefer the longest service when names share a prefix (react vs react-native)', () => {
    const services = [...SERVICES, 'react'].sort();
    const d = classifyChanges(['.github/workflows/_ci-e2e-react-native-all-providers.reusable.yml'], services);
    expect(d.runs['react-native']).toBe(true);
    expect(d.runs.react).toBe(false);
  });

  it('should run only react-native for its multi-word e2e workflow', () => {
    const d = decide(['.github/workflows/_ci-e2e-react-native-all-providers.reusable.yml']);
    expect(d.runs['react-native']).toBe(true);
    expect(d.runs.electron).toBe(false);
  });

  it('should run only tauri for the tauri-only script', () => {
    const d = decide(['scripts/update-tauri-version.ts']);
    expect(d.runs).toEqual({
      dioxus: false,
      electrobun: false,
      electron: false,
      flutter: false,
      'react-native': false,
      tauri: true,
    });
  });

  it('should run everything for a cross-service script', () => {
    const d = decide(['scripts/test-package.ts']);
    expect(Object.values(d.runs).every(Boolean)).toBe(true);
    expect(d.triggersAll).toEqual(['scripts/test-package.ts']);
  });

  it('should run everything and flag shared for a universal shared package change', () => {
    const d = decide(['packages/native-utils/src/teardown.ts']);
    expect(Object.values(d.runs).every(Boolean)).toBe(true);
    expect(d.sharedChanges).toBe(true);
    expect(d.triggersAll).toEqual([]);
  });

  it('should narrow a native-mobile-core change to the mobile services only (no desktop E2E)', () => {
    const d = decide(['packages/native-mobile-core/src/launcher.ts']);
    expect(d.runs).toEqual({
      dioxus: false,
      electrobun: false,
      electron: false,
      flutter: true,
      'react-native': true,
      tauri: false,
    });
    expect(d.sharedChanges).toBe(true);
    expect(d.lintOnly).toBe(false);
  });

  it('should narrow a native-cdp-bridge change to electron + electrobun + react-native', () => {
    const d = decide(['packages/native-cdp-bridge/src/connection.ts']);
    expect(d.runs).toEqual({
      dioxus: false,
      electrobun: true,
      electron: true,
      flutter: false,
      'react-native': true,
      tauri: false,
    });
    expect(d.sharedChanges).toBe(true);
  });

  it('should run typecheck/build but NO per-service E2E for a types-only native-types change', () => {
    const d = decide(['packages/native-types/src/react-native.ts']);
    // No service E2E — a type change is erased at compile time, build + unit cover it.
    expect(Object.values(d.runs).every((v) => v === false)).toBe(true);
    // …but it is NOT lint-only: sharedChanges keeps build + unit running.
    expect(d.sharedChanges).toBe(true);
    expect(d.lintOnly).toBe(false);
    expect(d.sharedDetail[0]).toMatchObject({ pkg: 'native-types', typesOnly: true, services: [] });
  });

  it('should treat native-types/src/shared.ts as types-only too (runtime axis, not "shared" name)', () => {
    const d = decide(['packages/native-types/src/shared.ts']);
    expect(Object.values(d.runs).every((v) => v === false)).toBe(true);
    expect(d.lintOnly).toBe(false);
  });

  it('should run every service for a bundler (build-tool) change', () => {
    const d = decide(['packages/bundler/src/index.ts']);
    expect(Object.values(d.runs).every(Boolean)).toBe(true);
    expect(d.sharedChanges).toBe(true);
  });

  it('should union narrowed shared + a service change (mobile-core + electron src)', () => {
    const d = decide(['packages/native-mobile-core/src/launcher.ts', 'packages/electron-service/src/x.ts']);
    expect(d.runs.flutter).toBe(true);
    expect(d.runs['react-native']).toBe(true);
    expect(d.runs.electron).toBe(true); // its own file triggers it independently
    expect(d.runs.tauri).toBe(false);
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
