import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import {
  buildCatalogConsumers,
  buildE2eDependencyServices,
  buildScriptDependencies,
  buildServiceDependents,
  classifyChanges,
  classifyFile,
  discoverServices,
  findCommentOnlyWorkflowChanges,
  isCommentOnlyYamlDiff,
  LINT_JOB_SCRIPTS,
  SCRIPTS_TSCONFIG,
  stripComments,
} from '../../scripts/detect-changes.ts';

const SERVICES = ['dioxus', 'electrobun', 'electron', 'flutter', 'react-native', 'tauri'];
const REPO_ROOT = new URL('../..', import.meta.url).pathname;
// Use the REAL workspace dependency graph so the narrowing tests reflect production exactly (and
// double as a guard: if a service's native-* deps change, the asserted closures below shift).
const DEPENDENTS = buildServiceDependents(REPO_ROOT, SERVICES);
const E2E_DEPS = buildE2eDependencyServices(REPO_ROOT, SERVICES);
const CATALOG_CONSUMERS = buildCatalogConsumers(REPO_ROOT);
if (!CATALOG_CONSUMERS) {
  throw new Error('buildCatalogConsumers could not read pnpm-lock.yaml');
}
const SCRIPT_DEPS = buildScriptDependencies(REPO_ROOT);
const MAPS = {
  dependents: DEPENDENTS,
  e2eDeps: E2E_DEPS,
  catalogConsumers: CATALOG_CONSUMERS,
  scriptDeps: SCRIPT_DEPS,
};

function decide(files: string[], forceAll = false) {
  return classifyChanges(files, SERVICES, { forceAll, ...MAPS });
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

describe('buildE2eDependencyServices', () => {
  it('should map each e2e dependency to the services whose E2E configs or specs reference it', () => {
    expect(E2E_DEPS['@crabnebula/tauri-driver']).toEqual(['tauri']);
    expect(E2E_DEPS['@crabnebula/test-runner-backend']).toEqual(['tauri']);
    expect(E2E_DEPS['appium-flutter-driver']).toEqual(['flutter']);
    expect(E2E_DEPS['@wdio/appium-service']).toEqual(['flutter', 'react-native']);
    expect(E2E_DEPS['appium-uiautomator2-driver']).toEqual(['flutter', 'react-native']);
    expect(E2E_DEPS['appium-xcuitest-driver']).toEqual(['flutter', 'react-native']);
    expect(E2E_DEPS['@wdio/electron-service']).toEqual(['electron']);
    expect(E2E_DEPS['@wdio/visual-service']).toEqual(['dioxus']);
    expect(E2E_DEPS['@wdio/cli']).toEqual([...SERVICES].sort());
    expect(E2E_DEPS.webdriverio).toEqual([...SERVICES].sort());
  });
});

describe('buildE2eDependencyServices with comments', () => {
  it('should ignore what comments name and keep the code around them', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-changes-'));
    try {
      fs.mkdirSync(path.join(root, 'e2e'));
      fs.writeFileSync(
        path.join(root, 'e2e/package.json'),
        JSON.stringify({ devDependencies: { 'appium-xcuitest-driver': '^11.0.0' } }),
      );
      fs.writeFileSync(
        path.join(root, 'e2e/wdio.react-native.conf.ts'),
        [
          "export const specs = ['./test/react-native/*.spec.ts'];",
          "/* eslint-disable */ const local = /^https?:\\/\\//; export const caps = [{ 'appium:automationName': 'XCUITest' }];",
          '// Logs land in e2e/logs/**/*.log',
        ].join('\n'),
      );
      fs.writeFileSync(
        path.join(root, 'e2e/wdio.tauri.conf.ts'),
        [
          'export const remote = /^https?:\\/\\//; // no Appium here',
          "/* Appium isn't",
          ' * used here */ export const specs = ["./test/tauri/*.spec.ts"];',
        ].join('\n'),
      );
      expect(buildE2eDependencyServices(root, ['react-native', 'tauri'])['appium-xcuitest-driver']).toEqual([
        'react-native',
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('stripComments on the e2e sources', () => {
  // It doesn't parse regex literals, so a quote or `/*` in one could make it drop real code.
  it('should keep every string and regex literal the TypeScript parser finds', () => {
    const files = repoFiles(`${REPO_ROOT}e2e`, /\.(ts|js|mjs)$/);
    expect(files).toContain('e2e/wdio.conf.ts');
    for (const file of files) {
      const text = fs.readFileSync(`${REPO_ROOT}${file}`, 'utf8');
      const stripped = stripComments(text);
      const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
      const missing: string[] = [];
      const visit = (node: ts.Node) => {
        if (
          ts.isStringLiteral(node) ||
          ts.isNoSubstitutionTemplateLiteral(node) ||
          ts.isRegularExpressionLiteral(node)
        ) {
          const literal = node.getText(source);
          if (!stripped.includes(literal)) {
            missing.push(literal);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      expect({ file, missing }).toEqual({ file, missing: [] });
    }
  });
});

describe('buildScriptDependencies', () => {
  it('should list the packages the scripts import, without built-ins or relative imports', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-changes-'));
    try {
      fs.mkdirSync(path.join(root, 'scripts/lib'), { recursive: true });
      fs.writeFileSync(
        path.join(root, 'scripts/a.ts'),
        ["import { parse } from 'yaml';", "import * as fs from 'node:fs';", "import { x } from './lib/x.ts';"].join(
          '\n',
        ),
      );
      fs.writeFileSync(
        path.join(root, 'scripts/lib/x.ts'),
        ["import '@scope/side-effect/register';", "const dyn = await import('dyn');", "require('cjs');"].join('\n'),
      );
      expect([...buildScriptDependencies(root)].sort()).toEqual(['@scope/side-effect', 'cjs', 'dyn', 'yaml']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('buildCatalogConsumers', () => {
  it('should map catalog dependencies to the importers that take them from the default catalog', () => {
    expect(CATALOG_CONSUMERS.default?.['@wdio/utils']).toEqual(['packages/electron-service']);
    expect(CATALOG_CONSUMERS.default?.['@wdio/visual-service']).toEqual(['e2e']);
    expect(CATALOG_CONSUMERS.default?.['@wdio/appium-service']).toEqual(['e2e']);
    expect(CATALOG_CONSUMERS.default?.['@wdio/logger']).toEqual(['packages/native-utils']);
    expect(CATALOG_CONSUMERS.default?.electron).toEqual(
      expect.arrayContaining(['packages/electron-service', 'packages/native-types']),
    );
  });

  it('should read the workspace packages from the lockfile importers and key them by catalog', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'detect-changes-'));
    const writePkg = (dir: string, pkg: Record<string, Record<string, string>>) => {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
      fs.writeFileSync(path.join(root, dir, 'package.json'), JSON.stringify(pkg));
    };
    try {
      fs.writeFileSync(
        path.join(root, 'pnpm-lock.yaml'),
        lockfileText({ importers: ['  .: {}', '  libs/a: {}', "  'apps/web': {}"].join('\n') }),
      );
      writePkg('.', { dependencies: { foo: 'catalog:' } });
      // A peer range on the same dependency mustn't hide the catalog spec.
      writePkg('libs/a', {
        devDependencies: { foo: 'catalog:default' },
        peerDependencies: { foo: '^1.0.0 || ^2.0.0' },
        dependencies: { bar: 'catalog:next' },
      });
      writePkg('apps/web', { dependencies: { foo: '^1.0.0', bar: 'catalog:next' } });
      writePkg('unlisted', { dependencies: { foo: 'catalog:' } });
      expect(buildCatalogConsumers(root)).toEqual({
        default: { foo: ['.', 'libs/a'] },
        next: { bar: ['apps/web', 'libs/a'] },
      });
      fs.rmSync(path.join(root, 'pnpm-lock.yaml'));
      expect(buildCatalogConsumers(root)).toBeUndefined();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('classifyFile', () => {
  it.each([
    // docs anywhere → none
    ['README.md', 'none'],
    ['packages/electron-service/README.md', 'none'],
    ['packages/dioxus-bridge/docs/release-notes/v1.0.0.md', 'none'],
    ['.claude/skills/add-native-service/SKILL.md', 'none'],
    // generated permission docs ship in the plugin crates → their service, not docs
    ['packages/tauri-plugin/permissions/autogenerated/reference.md', 'tauri'],
    ['packages/tauri-plugin-webdriver/permissions/autogenerated/reference.md', 'tauri'],
    // packages → service / shared / unknown→all
    ['packages/electron-service/src/session.ts', 'electron'],
    ['packages/native-cdp-bridge/src/connection.ts', 'shared'],
    ['packages/tauri-plugin/src/index.ts', 'tauri'],
    ['packages/tauri-plugin-webdriver/Cargo.toml', 'tauri'],
    ['packages/dioxus-bridge/src/lib.rs', 'dioxus'],
    ['packages/dioxus-embedded-driver/src/lib.rs', 'dioxus'],
    ['packages/dioxus-wdio/src/lib.rs', 'dioxus'],
    ['packages/native-utils/src/teardown.ts', 'shared'],
    ['packages/native-core/src/index.ts', 'shared'],
    ['packages/native-mobile-core/src/launcher.ts', 'shared'],
    ['packages/bundler/src/index.ts', 'shared'],
    // native-types ships only types, so a change to it can only break the build or the unit tests. Its
    // package.json still decides what its consumers install.
    ['packages/native-types/src/react-native.ts', 'build'],
    ['packages/native-types/src/shared.ts', 'build'],
    ['packages/native-types/package.json', 'shared'],
    ['packages/some-new-thing/src/index.ts', 'unknown'],
    // e2e
    ['e2e/test/electron/api.spec.ts', 'electron'],
    ['e2e/wdio.electron.conf.ts', 'electron'],
    ['e2e/wdio.dioxus-embedded.conf.ts', 'dioxus'],
    ['e2e/wdio.dioxus-browser.conf.ts', 'dioxus'],
    ['e2e/test/dioxus-browser/mock.spec.ts', 'dioxus'],
    ['e2e/package.json', 'all'],
    ['e2e/test/helpers/shared.ts', 'all'],
    // fixtures
    ['fixtures/e2e-apps/electron-builder/package.json', 'electron'],
    ['fixtures/e2e-apps/tauri/src-tauri/Cargo.toml', 'tauri'],
    ['fixtures/package-tests/dioxus-app/docker/test.sh', 'dioxus'],
    ['fixtures/e2e-apps/dioxus-browser/index.html', 'dioxus'],
    ['fixtures/package-tests/electrobun-app/wdio.conf.ts', 'electrobun'],
    ['fixtures/e2e-apps/mystery/app.ts', 'unknown'],
    // workflows
    ['.github/workflows/ci.yml', 'all'],
    ['.github/workflows/_ci-detect-changes.reusable.yml', 'all'],
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
    ['.github/workflows/crate-drift.yml', 'none'],
    ['.github/workflows/release.yml', 'none'],
    ['.github/workflows/_release.reusable.yml', 'none'],
    ['.github/workflows/standing-pr.yml', 'none'],
    ['.github/workflows/_standing-pr-update.reusable.yml', 'none'],
    ['.github/workflows/release-preview.yml', 'none'],
    ['.github/workflows/release-preview-comment.yml', 'none'],
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
    ['tsconfig.scripts.json', 'none'],
    ['tsconfig.scripts.dom.json', 'none'],
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

  it('should run tauri, not lint-only, for a change to only a generated permissions reference.md', () => {
    const d = decide(['packages/tauri-plugin-webdriver/permissions/autogenerated/reference.md']);
    expect(d.runs).toEqual(Object.fromEntries(SERVICES.map((svc) => [svc, svc === 'tauri'])));
    expect(d.lintOnly).toBe(false);
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

  it('should run build + unit, with no service E2E or shared changes, for a types-only native-types change', () => {
    const d = decide(['packages/native-types/src/react-native.ts']);
    // A type change is erased at compile time, so build + unit cover it.
    expect(Object.values(d.runs).every((v) => v === false)).toBe(true);
    expect(d.sharedChanges).toBe(false);
    expect(d.lintOnly).toBe(false);
    expect(d.sharedDetail).toEqual([]);
    expect(d.buildOnlyFiles).toEqual(['packages/native-types/src/react-native.ts']);
    expect(d.perFile).toEqual([{ file: 'packages/native-types/src/react-native.ts', verdict: 'build' }]);
  });

  it('should treat native-types/src/shared.ts as types-only too (runtime axis, not "shared" name)', () => {
    const d = decide(['packages/native-types/src/shared.ts']);
    expect(Object.values(d.runs).every((v) => v === false)).toBe(true);
    expect(d.sharedChanges).toBe(false);
    expect(d.lintOnly).toBe(false);
  });

  it('should run every service that takes native-types when its package.json changes', () => {
    const d = decide(['packages/native-types/package.json']);
    expect(d.runs).toEqual(Object.fromEntries(SERVICES.map((svc) => [svc, true])));
    expect(d.sharedChanges).toBe(true);
    expect(d.sharedDetail).toEqual([
      { file: 'packages/native-types/package.json', pkg: 'native-types', services: SERVICES },
    ]);
  });

  it('should still flag shared when a types-only change comes with a runtime shared change', () => {
    const d = decide(['packages/native-types/src/shared.ts', 'packages/native-mobile-core/src/launcher.ts']);
    expect(d.sharedChanges).toBe(true);
    expect(d.runs.flutter).toBe(true);
    expect(d.runs.electron).toBe(false);
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

  it('should run lint-only for a release commit, whatever it touched', () => {
    const files = [
      'CHANGELOG.md',
      'packages/native-utils/package.json',
      'packages/tauri-service/package.json',
      'packages/tauri-plugin-webdriver/Cargo.toml',
      'fixtures/e2e-apps/tauri/Cargo.lock',
    ];
    expect(decide(files).lintOnly).toBe(false);

    const d = classifyChanges(files, SERVICES, { releaseCommit: true, dependents: DEPENDENTS });
    expect(Object.values(d.runs).some(Boolean)).toBe(false);
    expect(d.sharedChanges).toBe(false);
    expect(d.lintOnly).toBe(true);
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

function lockfileText(parts: { importers?: string; packages?: string; snapshots?: string; catalogs?: string }): string {
  const catalogs = parts.catalogs ? `\ncatalogs:\n${parts.catalogs}` : '';
  return [
    "lockfileVersion: '9.0'",
    '',
    'settings:',
    '  autoInstallPeers: true',
    '',
    'importers:',
    parts.importers ?? '',
    '',
    'packages:',
    parts.packages ?? '',
    '',
    'snapshots:',
    parts.snapshots ?? '',
    catalogs,
    '',
  ].join('\n');
}

function importerBlock(importer: string, version: string): string {
  return [
    `  ${importer}:`,
    '    dependencies:',
    '      foo:',
    `        specifier: ${version}`,
    `        version: ${version}`,
  ].join('\n');
}

function packageBlock(name: string): string {
  return [`  ${name}:`, '    resolution: {integrity: abc}'].join('\n');
}

function snapshotBlock(name: string, dependency: string): string {
  return [`  ${name}:`, '    dependencies:', `      bar: ${dependency}`].join('\n');
}

function classifyLock(base: string, head: string) {
  return classifyChanges(['pnpm-lock.yaml'], SERVICES, { ...MAPS, manifests: { 'pnpm-lock.yaml': { base, head } } });
}

describe('pnpm-lock.yaml', () => {
  it('should run every pipeline when no base copy is available', () => {
    const d = decide(['pnpm-lock.yaml']);
    expect(Object.values(d.runs).every(Boolean)).toBe(true);
    expect(d.triggersAll).toEqual(['pnpm-lock.yaml']);
  });

  it('should run only the service whose importer changed', () => {
    const base = lockfileText({ importers: importerBlock('packages/tauri-plugin', '1.0.0') });
    const head = lockfileText({ importers: importerBlock('packages/tauri-plugin', '1.0.1') });
    const d = classifyLock(base, head);
    expect(d.runs).toEqual({
      dioxus: false,
      electrobun: false,
      electron: false,
      flutter: false,
      'react-native': false,
      tauri: true,
    });
    expect(d.triggersAll).toEqual([]);
  });

  it('should ignore a pruned orphan package beside one service importer', () => {
    const base = lockfileText({
      importers: importerBlock('packages/tauri-plugin', '1.0.0'),
      packages: packageBlock('leftover@1.0.0'),
      snapshots: snapshotBlock('leftover@1.0.0', '1.0.0'),
    });
    const head = lockfileText({ importers: importerBlock('packages/tauri-plugin', '1.0.1') });
    const d = classifyLock(base, head);
    expect(d.runs.tauri).toBe(true);
    expect(d.runs.electron).toBe(false);
    expect(d.triggersAll).toEqual([]);
    expect(d.lintOnly).toBe(false);
  });

  it('should run the dependents of a changed shared-package importer', () => {
    const base = lockfileText({ importers: importerBlock('packages/native-mobile-core', '1.0.0') });
    const head = lockfileText({ importers: importerBlock('packages/native-mobile-core', '1.0.1') });
    const d = classifyLock(base, head);
    expect(d.runs.flutter).toBe(true);
    expect(d.runs['react-native']).toBe(true);
    expect(d.runs.tauri).toBe(false);
    expect(d.sharedChanges).toBe(true);
  });

  it('should run build + unit only when the types-only package importer changes', () => {
    // Without dependencies of its own, its importer reaches only what its types build against.
    const nativeTypes = JSON.parse(fs.readFileSync(`${REPO_ROOT}packages/native-types/package.json`, 'utf8'));
    expect(nativeTypes.dependencies).toBeUndefined();
    expect(nativeTypes.optionalDependencies).toBeUndefined();
    const base = lockfileText({ importers: importerBlock('packages/native-types', '1.0.0') });
    const head = lockfileText({ importers: importerBlock('packages/native-types', '1.0.1') });
    const d = classifyLock(base, head);
    expect(Object.values(d.runs).some(Boolean)).toBe(false);
    expect(d.sharedChanges).toBe(false);
    expect(d.lintOnly).toBe(false);
    expect(d.buildOnlyFiles).toEqual(['pnpm-lock.yaml']);
    expect(d.perFile).toEqual([{ file: 'pnpm-lock.yaml', verdict: 'build' }]);
  });

  it('should run every pipeline when a snapshot changes in place', () => {
    const base = lockfileText({ snapshots: snapshotBlock("'foo@1.0.0'", '1.0.0') });
    const head = lockfileText({ snapshots: snapshotBlock("'foo@1.0.0'", '2.0.0') });
    const d = classifyLock(base, head);
    expect(Object.values(d.runs).every(Boolean)).toBe(true);
    expect(d.triggersAll).toEqual(['pnpm-lock.yaml']);
  });

  it('should run every pipeline when a catalog changes', () => {
    const catalog = (version: string) => [`  default:`, '    foo:', `      specifier: ${version}`].join('\n');
    const d = classifyLock(lockfileText({ catalogs: catalog('1.0.0') }), lockfileText({ catalogs: catalog('1.0.1') }));
    expect(Object.values(d.runs).every(Boolean)).toBe(true);
    expect(d.triggersAll).toEqual(['pnpm-lock.yaml']);
  });

  it('should run every pipeline when the root importer changes', () => {
    const d = classifyLock(
      lockfileText({ importers: importerBlock('.', '1.0.0') }),
      lockfileText({ importers: importerBlock('.', '1.0.1') }),
    );
    expect(Object.values(d.runs).every(Boolean)).toBe(true);
    expect(d.triggersAll).toEqual(['pnpm-lock.yaml']);
  });

  it('should stay lint-only when the only difference is a removed package', () => {
    const base = lockfileText({ packages: packageBlock('leftover@1.0.0') });
    const head = lockfileText({});
    const d = classifyLock(base, head);
    expect(Object.values(d.runs).every((run) => !run)).toBe(true);
    expect(d.lintOnly).toBe(true);
    expect(d.triggersAll).toEqual([]);
  });

  it('should stay lint-only when an inline `{}` package is added or removed', () => {
    const withLeaf = lockfileText({
      packages: [packageBlock("'kept@1.0.0'"), '', "  'leaf@1.0.0': {}"].join('\n'),
      snapshots: [snapshotBlock("'kept@1.0.0'", '1.0.0'), '', "  'leaf@1.0.0': {}"].join('\n'),
    });
    const withoutLeaf = lockfileText({
      packages: packageBlock("'kept@1.0.0'"),
      snapshots: snapshotBlock("'kept@1.0.0'", '1.0.0'),
    });
    for (const [base, head] of [
      [withLeaf, withoutLeaf],
      [withoutLeaf, withLeaf],
    ] as const) {
      const d = classifyLock(base, head);
      expect(d.lintOnly).toBe(true);
      expect(d.triggersAll).toEqual([]);
    }
  });

  it('should run every pipeline when an inline `{}` snapshot gains dependencies', () => {
    const base = lockfileText({ snapshots: "  'foo@1.0.0': {}" });
    const head = lockfileText({ snapshots: snapshotBlock("'foo@1.0.0'", '1.0.0') });
    const d = classifyLock(base, head);
    expect(Object.values(d.runs).every(Boolean)).toBe(true);
    expect(d.triggersAll).toEqual(['pnpm-lock.yaml']);
  });

  it('should run only the service whose inline `{}` importer changed', () => {
    const base = lockfileText({ importers: '  fixtures/e2e-apps/dioxus: {}' });
    const head = lockfileText({ importers: importerBlock('fixtures/e2e-apps/dioxus', '1.0.0') });
    const d = classifyLock(base, head);
    expect(d.runs).toEqual({
      dioxus: true,
      electrobun: false,
      electron: false,
      flutter: false,
      'react-native': false,
      tauri: false,
    });
  });

  it('should stay lint-only when an inline `{}` snapshot leaves the repo lockfile', () => {
    const real = fs.readFileSync(new URL('../../pnpm-lock.yaml', import.meta.url), 'utf8');
    const snapshots = real.lastIndexOf('\nsnapshots:\n');
    const inline = /\n {2}\S[^\n]*: \{\}\n\n/g;
    inline.lastIndex = snapshots;
    const match = inline.exec(real);
    if (!match) {
      throw new Error('no inline snapshot entry in pnpm-lock.yaml');
    }
    const head = real.slice(0, match.index + 1) + real.slice(match.index + match[0].length);
    const d = classifyLock(real, head);
    expect(d.lintOnly).toBe(true);
    expect(d.triggersAll).toEqual([]);
  });

  it('should classify one importer edit in the repo lockfile as that service', () => {
    const real = fs.readFileSync(new URL('../../pnpm-lock.yaml', import.meta.url), 'utf8');
    const marker = '  packages/tauri-plugin:\n';
    const start = real.indexOf(marker);
    const next = real.indexOf('\n  packages/', start + marker.length);
    const block = real.slice(start, next);
    const edited = block.replace('specifier: 2.12.4', 'specifier: 2.12.5');
    const head = `${real.slice(0, start)}${edited}${real.slice(next)}`;
    const d = classifyLock(real, head);
    expect(d.runs.tauri).toBe(true);
    expect(d.runs.electron).toBe(false);
    expect(d.runs.flutter).toBe(false);
    expect(d.triggersAll).toEqual([]);
    expect(d.unknownFiles).toEqual([]);
  });
});

function diffOf(...lines: string[]): string {
  return ['diff --git a/x.yml b/x.yml', '--- a/x.yml', '+++ b/x.yml', '@@ -1 +1 @@', ...lines].join('\n');
}

describe('isCommentOnlyYamlDiff', () => {
  it('should accept a diff that only changes comments', () => {
    expect(isCommentOnlyYamlDiff(diffOf('-      # Dioxus: target', '+      # Dioxus: target/dx'))).toBe(true);
  });

  it('should accept added comments and blank lines', () => {
    expect(isCommentOnlyYamlDiff(diffOf('+', '+# Why this job exists', '+   '))).toBe(true);
  });

  it('should reject a diff that also changes a value', () => {
    expect(isCommentOnlyYamlDiff(diffOf('-  # note', '+  # note', '-    run: a', '+    run: b'))).toBe(false);
  });

  it('should reject a comment added after a value', () => {
    expect(isCommentOnlyYamlDiff(diffOf('-    run: build', '+    run: build # fast'))).toBe(false);
  });

  it('should not count file headers as changed lines', () => {
    expect(isCommentOnlyYamlDiff('diff --git a/x.yml b/x.yml\n--- a/x.yml\n+++ b/x.yml')).toBe(false);
  });

  it('should reject an empty diff', () => {
    expect(isCommentOnlyYamlDiff('')).toBe(false);
  });
});

describe('findCommentOnlyWorkflowChanges', () => {
  const diffs: Record<string, string | undefined> = {
    '.github/workflows/_ci-package.reusable.yml': diffOf('-      # old', '+      # new'),
    '.github/workflows/_ci-build.reusable.yml': diffOf('-    run: a', '+    run: b'),
    '.github/workflows/codeql.yml': diffOf('-  # old', '+  # new'),
    '.github/workflows/_ci-unit.reusable.yml': undefined,
  };
  const files = [...Object.keys(diffs), 'scripts/test-package.ts'];

  it('should find the workflow files whose diff only touches comments', () => {
    const found = findCommentOnlyWorkflowChanges(files, SERVICES, (file) => diffs[file]);
    expect([...found]).toEqual(['.github/workflows/_ci-package.reusable.yml']);
  });

  it('should only read diffs of workflow files that would run pipelines', () => {
    const readDiff = vi.fn((file: string) => diffs[file]);
    findCommentOnlyWorkflowChanges(files, SERVICES, readDiff);
    expect(readDiff.mock.calls.map(([file]) => file)).toEqual([
      '.github/workflows/_ci-package.reusable.yml',
      '.github/workflows/_ci-build.reusable.yml',
      '.github/workflows/_ci-unit.reusable.yml',
    ]);
  });
});

describe('classifyChanges with comment-only workflow changes', () => {
  it('should run only dioxus when the core workflow change is comment-only', () => {
    const d = classifyChanges(
      ['.github/workflows/_ci-package.reusable.yml', 'fixtures/package-tests/dioxus-app/wdio.conf.ts'],
      SERVICES,
      { dependents: DEPENDENTS, commentOnly: new Set(['.github/workflows/_ci-package.reusable.yml']) },
    );
    expect(d.runs).toEqual(Object.fromEntries(SERVICES.map((svc) => [svc, svc === 'dioxus'])));
    expect(d.triggersAll).toEqual([]);
    expect(d.commentOnlyFiles).toEqual(['.github/workflows/_ci-package.reusable.yml']);
  });

  it('should run lint-only for a comment-only workflow change on its own', () => {
    const d = classifyChanges(['.github/workflows/ci.yml'], SERVICES, {
      dependents: DEPENDENTS,
      commentOnly: new Set(['.github/workflows/ci.yml']),
    });
    expect(d.lintOnly).toBe(true);
  });
});

function classifyManifest(
  file: 'package.json' | 'e2e/package.json' | 'pnpm-workspace.yaml',
  base: string,
  head: string,
) {
  return classifyChanges([file], SERVICES, { ...MAPS, manifests: { [file]: { base, head } } });
}

describe('dependency manifests that match their base copy', () => {
  // A manual run on main lists the last commit's files but diffs against main itself.
  it.each(['package.json', 'e2e/package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml'] as const)(
    'should run every pipeline for %s',
    (file) => {
      const text = fs.readFileSync(`${REPO_ROOT}${file}`, 'utf8');
      const d = classifyChanges([file], SERVICES, { ...MAPS, manifests: { [file]: { base: text, head: text } } });
      expect(Object.values(d.runs).every(Boolean)).toBe(true);
      expect(d.perFile).toEqual([{ file, verdict: 'all' }]);
    },
  );
});

describe('root package.json', () => {
  const pkgJson = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({
      name: '@wdio/desktop-mobile',
      private: true,
      scripts: { build: 'turbo run build' },
      devDependencies: {
        '@biomejs/biome': '2.6.2',
        '@releasekit/release': '^0.42.0',
        eslint: '^10.3.0',
        vitest: '^4.1.0',
        typescript: '^5.9.3',
        turbo: '^2.9.6',
      },
      ...overrides,
    });

  it('should run every pipeline when no base copy is available', () => {
    const d = decide(['package.json']);
    expect(Object.values(d.runs).every(Boolean)).toBe(true);
    expect(d.triggersAll).toEqual(['package.json']);
  });

  it('should stay lint-only when only release or lint devDependencies change', () => {
    const base = pkgJson();
    const head = pkgJson({
      devDependencies: {
        '@biomejs/biome': '2.6.3',
        '@releasekit/release': '^0.42.1',
        eslint: '^10.3.1',
        vitest: '^4.1.0',
        typescript: '^5.9.3',
        turbo: '^2.9.6',
      },
    });
    const d = classifyManifest('package.json', base, head);
    expect(Object.values(d.runs).every((v) => !v)).toBe(true);
    expect(d.sharedChanges).toBe(false);
    expect(d.lintOnly).toBe(true);
    expect(d.perFile).toEqual([{ file: 'package.json', verdict: 'none' }]);
  });

  it('should stay lint-only when only lint tooling or git hook devDependencies change', () => {
    const base = pkgJson();
    const head = pkgJson({
      devDependencies: {
        ...JSON.parse(base).devDependencies,
        '@vitest/eslint-plugin': '^1.6.29',
        globals: '^17.14.0',
        'lint-staged': '^17.7.0',
      },
    });
    const d = classifyManifest('package.json', base, head);
    expect(d.lintOnly).toBe(true);
    expect(d.perFile).toEqual([{ file: 'package.json', verdict: 'none' }]);
  });

  it('should run build + unit, with no service pipeline or shared-package job, for build, test or install devDependencies', () => {
    const base = pkgJson();
    const devDependencies = JSON.parse(base).devDependencies;
    // husky runs on every install, through `prepare`.
    for (const head of [
      pkgJson({ devDependencies: { ...devDependencies, vitest: '^4.2.0' } }),
      pkgJson({ devDependencies: { ...devDependencies, husky: '^9.1.8' } }),
    ]) {
      const d = classifyManifest('package.json', base, head);
      expect(Object.values(d.runs).every((v) => !v)).toBe(true);
      expect(d.sharedChanges).toBe(false);
      expect(d.lintOnly).toBe(false);
      expect(d.triggersAll).toEqual([]);
      expect(d.buildOnlyFiles).toEqual(['package.json']);
      expect(d.perFile).toEqual([{ file: 'package.json', verdict: 'build' }]);
    }
  });

  it('should run every pipeline for a build devDependency when it has no list of what the scripts import', () => {
    const base = pkgJson();
    const head = pkgJson({ devDependencies: { ...JSON.parse(base).devDependencies, vitest: '^4.2.0' } });
    const d = classifyChanges(['package.json'], SERVICES, {
      ...MAPS,
      scriptDeps: undefined,
      manifests: { 'package.json': { base, head } },
    });
    expect(Object.values(d.runs).every(Boolean)).toBe(true);
  });

  it('should run every pipeline when any other devDependency changes, such as turbo', () => {
    const base = pkgJson();
    const devDependencies = JSON.parse(base).devDependencies;
    for (const head of [
      pkgJson({ devDependencies: { ...devDependencies, turbo: '^2.9.7' } }),
      pkgJson({ devDependencies: { ...devDependencies, 'some-new-tool': '^1.0.0' } }),
    ]) {
      const d = classifyManifest('package.json', base, head);
      expect(Object.values(d.runs).every(Boolean)).toBe(true);
      expect(d.perFile).toEqual([{ file: 'package.json', verdict: 'all' }]);
    }
  });

  it('should run every pipeline when a devDependency the scripts import changes', () => {
    expect(SCRIPT_DEPS.has('yaml')).toBe(true);
    const base = pkgJson();
    const head = pkgJson({ devDependencies: { ...JSON.parse(base).devDependencies, yaml: '^3.0.0' } });
    const d = classifyManifest('package.json', base, head);
    expect(Object.values(d.runs).every(Boolean)).toBe(true);
    expect(d.perFile).toEqual([{ file: 'package.json', verdict: 'all' }]);
  });

  it('should stay lint-only when only scripts the lint job runs change', () => {
    const base = pkgJson();
    const head = pkgJson({
      scripts: { build: 'turbo run build', 'typecheck:scripts': 'tsc --noEmit -p tsconfig.scripts.json' },
    });
    const d = classifyManifest('package.json', base, head);
    expect(Object.values(d.runs).every((v) => !v)).toBe(true);
    expect(d.lintOnly).toBe(true);
    expect(d.perFile).toEqual([{ file: 'package.json', verdict: 'none' }]);
  });

  it('should run build + unit with no service E2E when a lint-job script and a test devDependency change', () => {
    const base = pkgJson();
    const head = pkgJson({
      scripts: { build: 'turbo run build', 'typecheck:scripts': 'tsc --noEmit -p tsconfig.scripts.json' },
      devDependencies: { ...JSON.parse(base).devDependencies, '@types/jsdom': '^28.0.1' },
    });
    const d = classifyManifest('package.json', base, head);
    expect(Object.values(d.runs).every((v) => !v)).toBe(true);
    expect(d.lintOnly).toBe(false);
    expect(d.perFile).toEqual([{ file: 'package.json', verdict: 'build' }]);
  });

  it('should run every pipeline when scripts, engines, or packageManager change', () => {
    const base = pkgJson();
    for (const head of [
      pkgJson({ scripts: { build: 'turbo run build --force' } }),
      pkgJson({ scripts: { build: 'turbo run build --force', 'test:scripts': 'vitest run' } }),
      pkgJson({ engines: { node: '>=24' } }),
      pkgJson({ packageManager: 'pnpm@12.16.0' }),
    ]) {
      const d = classifyManifest('package.json', base, head);
      expect(Object.values(d.runs).every(Boolean)).toBe(true);
      expect(d.triggersAll).toEqual(['package.json']);
      expect(d.perFile).toEqual([{ file: 'package.json', verdict: 'all' }]);
    }
  });

  it('should run every pipeline and flag unknown when package.json cannot be parsed', () => {
    const d = classifyManifest('package.json', pkgJson(), '{not-json');
    expect(Object.values(d.runs).every(Boolean)).toBe(true);
    expect(d.unknownFiles).toEqual(['package.json']);
  });
});

const GITHUB_DIR = `${REPO_ROOT}.github`;
// Comment lines can name a script without running it.
const WORKFLOWS = fs
  .readdirSync(GITHUB_DIR, { recursive: true, encoding: 'utf8' })
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => ({
    name: name.split(path.sep).join('/'),
    text: fs
      .readFileSync(path.join(GITHUB_DIR, name), 'utf8')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n'),
  }));
const ROOT_SCRIPTS: Record<string, string> = JSON.parse(fs.readFileSync(`${REPO_ROOT}package.json`, 'utf8')).scripts;

function rootScriptsCalling(text: string): string[] {
  return Object.keys(ROOT_SCRIPTS).filter((key) => ROOT_SCRIPTS[key]?.includes(text));
}

function repoFiles(dir: string, match: RegExp): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.') || ['node_modules', 'dist', 'target'].includes(entry.name)) {
      return [];
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return repoFiles(fullPath, match);
    }
    return match.test(entry.name) ? [path.relative(REPO_ROOT, fullPath).split(path.sep).join('/')] : [];
  });
}

// Every script in every package.json, the root's included.
const PACKAGE_SCRIPTS = repoFiles(REPO_ROOT, /^package\.json$/).flatMap((file) =>
  Object.entries<string>(JSON.parse(fs.readFileSync(`${REPO_ROOT}${file}`, 'utf8')).scripts ?? {}).map(
    ([key, text]) => ({ name: `${file} ${key}`, text }),
  ),
);

describe('scripts only the lint job runs', () => {
  it.each([...LINT_JOB_SCRIPTS])('should run %s from the lint job alone', (name) => {
    const runs = new RegExp(`\\bpnpm(?: -\\S+)*(?: run)? ${name}(?![\\w:-])`);
    expect(WORKFLOWS.filter((w) => runs.test(w.text)).map((w) => w.name)).toEqual(['workflows/_ci-lint.reusable.yml']);
    expect(PACKAGE_SCRIPTS.filter((script) => script.text.includes(name)).map((script) => script.name)).toEqual([]);
  });

  it('should read the scripts tsconfigs only from those scripts', () => {
    const readers = rootScriptsCalling('tsconfig.scripts');
    expect(readers).not.toEqual([]);
    expect(readers.filter((key) => !LINT_JOB_SCRIPTS.has(key))).toEqual([]);
    const otherTsconfigs = repoFiles(REPO_ROOT, /^tsconfig.*\.json$/).filter((file) => !SCRIPTS_TSCONFIG.test(file));
    expect(otherTsconfigs).toContain('packages/native-types/tsconfig.json');
    for (const file of otherTsconfigs) {
      expect(fs.readFileSync(`${REPO_ROOT}${file}`, 'utf8')).not.toContain('tsconfig.scripts');
    }
  });
});

describe('catalog switching', () => {
  it('should run from no workflow, repo script or other package script', () => {
    const switchers = rootScriptsCalling('switch-catalog');
    expect(switchers).not.toEqual([]);
    const ownScripts = new Set(switchers.map((key) => `package.json ${key}`));
    const repoScripts = repoFiles(`${REPO_ROOT}scripts`, /\.([cm]?[jt]s|sh|ps1)$/)
      .filter((file) => file !== 'scripts/switch-catalog.ts')
      .map((file) => ({ name: file, text: fs.readFileSync(`${REPO_ROOT}${file}`, 'utf8') }));
    expect(PACKAGE_SCRIPTS.map((script) => script.name)).toContain('e2e/package.json test');
    for (const name of ['switch-catalog', ...switchers]) {
      const callers = [...WORKFLOWS, ...PACKAGE_SCRIPTS, ...repoScripts].filter(
        (caller) => caller.text.includes(name) && !ownScripts.has(caller.name),
      );
      expect(callers.map((caller) => caller.name)).toEqual([]);
    }
  });
});

describe('pnpm-workspace.yaml settings', () => {
  // The catalog consumer map reads only package.json files, so it would miss an entry that an override takes.
  it('should take catalog entries only in package.json files', () => {
    const text = fs
      .readFileSync(`${REPO_ROOT}pnpm-workspace.yaml`, 'utf8')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    const sections = text.split(/^(?=\S)/m);
    expect(sections.some((section) => section.startsWith('packages:'))).toBe(true);
    expect(sections.filter((section) => !/^catalogs?:/.test(section) && section.includes('catalog:'))).toEqual([]);
  });
});

describe('e2e/package.json', () => {
  const e2eJson = (
    deps: Record<string, string> = {},
    devDeps: Record<string, string> = {},
    extra: Record<string, unknown> = {},
  ) =>
    JSON.stringify({
      name: '@wdio/native-e2e',
      private: true,
      scripts: { test: 'wdio run ./wdio.electron.conf.ts' },
      dependencies: {
        '@wdio/appium-service': 'catalog:',
        '@wdio/cli': 'catalog:',
        '@wdio/electron-service': 'workspace:*',
        '@wdio/visual-service': 'catalog:',
        ...deps,
      },
      devDependencies: {
        '@crabnebula/tauri-driver': '^2.0.9',
        '@crabnebula/test-runner-backend': '^0.3.0',
        'appium-flutter-driver': '3.2.0',
        'appium-uiautomator2-driver': '^6.0.0',
        ...devDeps,
      },
      ...extra,
    });

  it('should run every pipeline when no base copy is available', () => {
    const d = decide(['e2e/package.json']);
    expect(Object.values(d.runs).every(Boolean)).toBe(true);
    expect(d.triggersAll).toEqual(['e2e/package.json']);
  });

  it('should narrow @crabnebula/* changes to tauri only', () => {
    const base = e2eJson();
    for (const head of [
      e2eJson({}, { '@crabnebula/tauri-driver': '^2.0.10' }),
      e2eJson({}, { '@crabnebula/test-runner-backend': '^0.3.1' }),
    ]) {
      const d = classifyManifest('e2e/package.json', base, head);
      expect(d.runs).toEqual(Object.fromEntries(SERVICES.map((svc) => [svc, svc === 'tauri'])));
      expect(d.triggersAll).toEqual([]);
      expect(d.perFile).toEqual([{ file: 'e2e/package.json', verdict: 'tauri' }]);
    }
  });

  it('should narrow appium-flutter-driver to flutter only', () => {
    const d = classifyManifest('e2e/package.json', e2eJson(), e2eJson({}, { 'appium-flutter-driver': '3.3.0' }));
    expect(d.runs).toEqual(Object.fromEntries(SERVICES.map((svc) => [svc, svc === 'flutter'])));
    expect(d.triggersAll).toEqual([]);
    expect(d.perFile).toEqual([{ file: 'e2e/package.json', verdict: 'flutter' }]);
  });

  it('should narrow @wdio/appium-service and mobile appium drivers to flutter + react-native', () => {
    const base = e2eJson();
    for (const head of [
      e2eJson({ '@wdio/appium-service': '^10.2.0' }),
      e2eJson({}, { 'appium-uiautomator2-driver': '^6.1.0' }),
    ]) {
      const d = classifyManifest('e2e/package.json', base, head);
      expect(d.runs).toEqual({
        dioxus: false,
        electrobun: false,
        electron: false,
        flutter: true,
        'react-native': true,
        tauri: false,
      });
      expect(d.triggersAll).toEqual([]);
      expect(d.perFile).toEqual([{ file: 'e2e/package.json', verdict: 'flutter,react-native' }]);
    }
  });

  it('should narrow @wdio/visual-service to dioxus only', () => {
    const d = classifyManifest('e2e/package.json', e2eJson(), e2eJson({ '@wdio/visual-service': '^11.1.0' }));
    expect(d.runs).toEqual(Object.fromEntries(SERVICES.map((svc) => [svc, svc === 'dioxus'])));
    expect(d.perFile).toEqual([{ file: 'e2e/package.json', verdict: 'dioxus' }]);
  });

  it('should union services when multiple service-specific E2E dependencies change', () => {
    const d = classifyManifest(
      'e2e/package.json',
      e2eJson(),
      e2eJson({}, { '@crabnebula/tauri-driver': '^2.0.10', 'appium-flutter-driver': '3.3.0' }),
    );
    expect(d.runs).toEqual({
      dioxus: false,
      electrobun: false,
      electron: false,
      flutter: true,
      'react-native': false,
      tauri: true,
    });
    expect(d.perFile).toEqual([{ file: 'e2e/package.json', verdict: 'flutter,tauri' }]);
  });

  it('should run every pipeline for shared runner dependencies, unknown dependencies, or scripts edits', () => {
    const base = e2eJson();
    for (const head of [
      e2eJson({ '@wdio/cli': '^10.2.0' }),
      e2eJson({}, { 'some-unrecognised-runner-pkg': '^1.0.0' }),
      e2eJson({}, {}, { scripts: { test: 'wdio run ./wdio.tauri.conf.ts' } }),
    ]) {
      const d = classifyManifest('e2e/package.json', base, head);
      expect(Object.values(d.runs).every(Boolean)).toBe(true);
      expect(d.triggersAll).toEqual(['e2e/package.json']);
      expect(d.perFile).toEqual([{ file: 'e2e/package.json', verdict: 'all' }]);
    }
  });
});

describe('pnpm-workspace.yaml', () => {
  const workspaceYaml = (catalogOverrides: Record<string, string> = {}, extraSection = '') => {
    const catalogEntries = {
      '@wdio/utils': '^10.1.0',
      '@wdio/appium-service': '^10.1.0',
      '@wdio/visual-service': '^11.0.0',
      '@wdio/cli': '^10.1.0',
      ...catalogOverrides,
    };
    return [
      'packages:',
      '  - packages/*',
      '  - e2e',
      '',
      'catalogs:',
      '  default:',
      ...Object.entries(catalogEntries).map(([k, v]) => `    '${k}': ${v}`),
      extraSection,
    ].join('\n');
  };

  it('should run every pipeline when no base copy is available', () => {
    const d = decide(['pnpm-workspace.yaml']);
    expect(Object.values(d.runs).every(Boolean)).toBe(true);
    expect(d.triggersAll).toEqual(['pnpm-workspace.yaml']);
  });

  it('should narrow @wdio/utils catalog changes to electron (its only consumer)', () => {
    const d = classifyManifest('pnpm-workspace.yaml', workspaceYaml(), workspaceYaml({ '@wdio/utils': '^10.2.0' }));
    expect(d.runs).toEqual(Object.fromEntries(SERVICES.map((svc) => [svc, svc === 'electron'])));
    expect(d.triggersAll).toEqual([]);
    expect(d.perFile).toEqual([{ file: 'pnpm-workspace.yaml', verdict: 'electron' }]);
  });

  it('should read the single `catalog:` form as the default catalog', () => {
    const yaml = (version: string) =>
      ['packages:', '  - packages/*', 'catalog:', `  '@wdio/utils': ${version}`, '  "@wdio/cli": ^10.1.0'].join('\n');
    const d = classifyManifest('pnpm-workspace.yaml', yaml('^10.1.0'), yaml('^10.2.0'));
    expect(d.runs).toEqual(Object.fromEntries(SERVICES.map((svc) => [svc, svc === 'electron'])));
    expect(d.perFile).toEqual([{ file: 'pnpm-workspace.yaml', verdict: 'electron' }]);
  });

  it('should narrow @wdio/appium-service catalog changes to flutter + react-native', () => {
    const d = classifyManifest(
      'pnpm-workspace.yaml',
      workspaceYaml(),
      workspaceYaml({ '@wdio/appium-service': '^10.2.0' }),
    );
    expect(d.runs).toEqual({
      dioxus: false,
      electrobun: false,
      electron: false,
      flutter: true,
      'react-native': true,
      tauri: false,
    });
    expect(d.triggersAll).toEqual([]);
    expect(d.perFile).toEqual([{ file: 'pnpm-workspace.yaml', verdict: 'flutter,react-native' }]);
  });

  it('should narrow @wdio/visual-service catalog changes to dioxus', () => {
    const d = classifyManifest(
      'pnpm-workspace.yaml',
      workspaceYaml(),
      workspaceYaml({ '@wdio/visual-service': '^11.1.0' }),
    );
    expect(d.runs).toEqual(Object.fromEntries(SERVICES.map((svc) => [svc, svc === 'dioxus'])));
    expect(d.perFile).toEqual([{ file: 'pnpm-workspace.yaml', verdict: 'dioxus' }]);
  });

  it('should narrow a shared-package catalog consumer via its runtime dependents', () => {
    const d = classifyChanges(['pnpm-workspace.yaml'], SERVICES, {
      dependents: DEPENDENTS,
      e2eDeps: E2E_DEPS,
      catalogConsumers: {
        ...CATALOG_CONSUMERS,
        default: { ...CATALOG_CONSUMERS.default, 'mobile-only-dep': ['packages/native-mobile-core'] },
      },
      manifests: {
        'pnpm-workspace.yaml': {
          base: workspaceYaml({ 'mobile-only-dep': '^1.0.0' }),
          head: workspaceYaml({ 'mobile-only-dep': '^1.1.0' }),
        },
      },
    });
    expect(d.runs).toEqual({
      dioxus: false,
      electrobun: false,
      electron: false,
      flutter: true,
      'react-native': true,
      tauri: false,
    });
    expect(d.sharedChanges).toBe(true);
    expect(d.perFile).toEqual([{ file: 'pnpm-workspace.yaml', verdict: 'shared' }]);
  });

  it('should run only electron for a default-catalog electron bump, though native-types takes it too', () => {
    const d = classifyManifest('pnpm-workspace.yaml', workspaceYaml(), workspaceYaml({ electron: '46.0.0' }));
    expect(d.runs).toEqual(Object.fromEntries(SERVICES.map((svc) => [svc, svc === 'electron'])));
    expect(d.sharedChanges).toBe(false);
    expect(d.sharedDetail).toEqual([]);
    expect(d.buildOnlyFiles).toEqual([]);
    expect(d.perFile).toEqual([{ file: 'pnpm-workspace.yaml', verdict: 'electron' }]);
  });

  it('should run nothing for an entry in a named catalog that no package takes', () => {
    const yaml = (nightly: string) =>
      [workspaceYaml(), '  next:', `    electron-nightly: ${nightly}`, `    '@wdio/cli': latest`].join('\n');
    const d = classifyManifest('pnpm-workspace.yaml', yaml('47.0.0-nightly.20261023'), yaml('47.0.0-nightly.20261030'));
    expect(d.lintOnly).toBe(true);
    expect(d.perFile).toEqual([{ file: 'pnpm-workspace.yaml', verdict: 'none' }]);
  });

  it('should classify a named catalog entry by the packages that take it', () => {
    const yaml = (version: string) => [workspaceYaml(), '  next:', `    '@wdio/utils': ${version}`].join('\n');
    const d = classifyChanges(['pnpm-workspace.yaml'], SERVICES, {
      ...MAPS,
      catalogConsumers: { ...CATALOG_CONSUMERS, next: { '@wdio/utils': ['packages/tauri-service'] } },
      manifests: { 'pnpm-workspace.yaml': { base: yaml('10.1.0'), head: yaml('10.2.0') } },
    });
    expect(d.runs).toEqual(Object.fromEntries(SERVICES.map((svc) => [svc, svc === 'tauri'])));
  });

  it('should run every pipeline for a named catalog entry when it has no consumer map', () => {
    const yaml = (version: string) => [workspaceYaml(), '  next:', `    '@wdio/utils': ${version}`].join('\n');
    const d = classifyChanges(['pnpm-workspace.yaml'], SERVICES, {
      ...MAPS,
      catalogConsumers: undefined,
      manifests: { 'pnpm-workspace.yaml': { base: yaml('10.1.0'), head: yaml('10.2.0') } },
    });
    expect(Object.values(d.runs).every(Boolean)).toBe(true);
  });

  it('should run every pipeline and flag unknown for a flow-style catalog', () => {
    const yaml = (version: string) => ['packages:', '  - packages/*', `catalog: { electron: ${version} }`].join('\n');
    const d = classifyManifest('pnpm-workspace.yaml', yaml('45.0.0'), yaml('46.0.0'));
    expect(Object.values(d.runs).every(Boolean)).toBe(true);
    expect(d.unknownFiles).toEqual(['pnpm-workspace.yaml']);
  });

  it('should run every pipeline for cross-service catalog deps, unreferenced catalog deps, or non-catalog sections', () => {
    const base = workspaceYaml();
    for (const head of [
      workspaceYaml({ '@wdio/cli': '^10.2.0' }),
      workspaceYaml({ 'unreferenced-pkg': '^1.0.0' }),
      workspaceYaml({}, '\noverrides:\n  foo: 1.0.0'),
    ]) {
      const d = classifyManifest('pnpm-workspace.yaml', base, head);
      expect(Object.values(d.runs).every(Boolean)).toBe(true);
      expect(d.triggersAll).toEqual(['pnpm-workspace.yaml']);
      expect(d.perFile).toEqual([{ file: 'pnpm-workspace.yaml', verdict: 'all' }]);
    }
  });
});

describe('pnpm-lock.yaml root/e2e importer and catalog narrowing', () => {
  it('should stay lint-only when the root importer only bumps release or lint devDependencies', () => {
    const rootDevBlock = (version: string) =>
      [
        '  .:',
        '    devDependencies:',
        "      '@biomejs/biome':",
        `        specifier: ${version}`,
        `        version: ${version}`,
      ].join('\n');
    const d = classifyLock(
      lockfileText({ importers: rootDevBlock('2.6.2') }),
      lockfileText({ importers: rootDevBlock('2.6.3') }),
    );
    expect(Object.values(d.runs).every((v) => !v)).toBe(true);
    expect(d.sharedChanges).toBe(false);
    expect(d.lintOnly).toBe(true);
  });

  it('should run build + unit with no service pipeline when the root importer bumps build/test devDependencies', () => {
    const rootDevBlock = (version: string) =>
      [
        '  .:',
        '    devDependencies:',
        '      vitest:',
        `        specifier: ${version}`,
        `        version: ${version}`,
      ].join('\n');
    const d = classifyLock(
      lockfileText({ importers: rootDevBlock('4.1.0') }),
      lockfileText({ importers: rootDevBlock('4.2.0') }),
    );
    expect(Object.values(d.runs).every((v) => !v)).toBe(true);
    expect(d.sharedChanges).toBe(false);
    expect(d.lintOnly).toBe(false);
  });

  it('should run every pipeline when the root importer bumps a devDependency the scripts import', () => {
    const rootDevBlock = (version: string) =>
      [
        '  .:',
        '    devDependencies:',
        '      yaml:',
        `        specifier: ^${version}`,
        `        version: ${version}`,
      ].join('\n');
    const d = classifyLock(
      lockfileText({ importers: rootDevBlock('2.9.1') }),
      lockfileText({ importers: rootDevBlock('3.0.0') }),
    );
    expect(Object.values(d.runs).every(Boolean)).toBe(true);
  });

  // As in the real e2e importer, `version:` lists each dependency's resolved peers.
  const e2eImporter = (visual: string, puppeteer = '25.16.0', visualInCli = visual) =>
    [
      '  e2e:',
      '    dependencies:',
      "      '@wdio/cli':",
      '        specifier: catalog:',
      `        version: 10.1.0(@types/node@26.6.5)(@wdio/visual-service@${visualInCli}(webdriverio@10.1.0(puppeteer-core@${puppeteer})))(puppeteer-core@${puppeteer})`,
      "      '@wdio/visual-service':",
      '        specifier: catalog:',
      `        version: ${visual}(webdriverio@10.1.0(puppeteer-core@${puppeteer}))`,
      '    devDependencies:',
      "      '@types/node':",
      '        specifier: ^26.6.5',
      '        version: 26.6.5',
    ].join('\n');

  it('should narrow a dependency that other entries list as a peer', () => {
    const d = classifyLock(
      lockfileText({ importers: e2eImporter('11.0.0') }),
      lockfileText({ importers: e2eImporter('11.1.0') }),
    );
    expect(d.runs).toEqual(Object.fromEntries(SERVICES.map((svc) => [svc, svc === 'dioxus'])));
  });

  it("should run every pipeline when a peer that isn't one of the importer's dependencies changes", () => {
    const d = classifyLock(
      lockfileText({ importers: e2eImporter('11.0.0') }),
      lockfileText({ importers: e2eImporter('11.1.0', '25.17.0') }),
    );
    expect(Object.values(d.runs).every(Boolean)).toBe(true);
  });

  it("should run every pipeline when only an importer dependency's peer changed", () => {
    const d = classifyLock(
      lockfileText({ importers: e2eImporter('11.0.0') }),
      lockfileText({ importers: e2eImporter('11.0.0', '25.16.0', '11.1.0') }),
    );
    expect(Object.values(d.runs).every(Boolean)).toBe(true);
  });

  it('should narrow an e2e importer dependency change to the affected service', () => {
    const e2eBlock = (version: string) =>
      [
        '  e2e:',
        '    devDependencies:',
        "      '@crabnebula/test-runner-backend':",
        `        specifier: ^${version}`,
        `        version: ${version}`,
      ].join('\n');
    const d = classifyLock(
      lockfileText({ importers: e2eBlock('0.2.9') }),
      lockfileText({ importers: e2eBlock('0.3.0') }),
    );
    expect(d.runs).toEqual(Object.fromEntries(SERVICES.map((svc) => [svc, svc === 'tauri'])));
    expect(d.triggersAll).toEqual([]);
  });

  it('should narrow a lockfile catalog entry change to its workspace consumers', () => {
    const catalog = (version: string) =>
      ['  default:', "    '@wdio/utils':", `      specifier: ^${version}`, `      version: ${version}`].join('\n');
    const d = classifyLock(
      lockfileText({ catalogs: catalog('10.1.0') }),
      lockfileText({ catalogs: catalog('10.2.0') }),
    );
    expect(d.runs).toEqual(Object.fromEntries(SERVICES.map((svc) => [svc, svc === 'electron'])));
    expect(d.triggersAll).toEqual([]);
  });
});
