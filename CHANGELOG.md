# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).



## [@wdio/electron-service@10.2.0] - 2026-08-03

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-electron-service@v10.1.0...wdio-electron-service@v10.2.0)

### New
- **DevServer auto-start**: Dev server auto-start is now wired into all four browser-mode launchers (Dioxus, Tauri, Electrobun, Electron). When devServer is configured, it starts automatically before tests run and the URL is propagated to caps for workers. (PR [#505](https://github.com/webdriverio/desktop-mobile/pull/505))

### Fixed
- Fixed version resolution for npm dist-tags (like 'latest', 'next', 'beta'), partial version ranges (like '^37'), and file/git URLs. Previously these would fail with a misleading error even when Electron was installed. (PR [#577](https://github.com/webdriverio/desktop-mobile/pull/577))
- Browser-mode now throws a clear error when using a non-Chrome browserName instead of silently rewriting it. Also added a preflight check that fails fast with an actionable error if the dev server is unreachable. (PR [#490](https://github.com/webdriverio/desktop-mobile/pull/490) · closes [#416](https://github.com/webdriverio/desktop-mobile/issues/416))
- Fixed an unhandled promise rejection in MockUpdateScheduler that could crash the WDIO worker when a queued batch failed. (PR [#475](https://github.com/webdriverio/desktop-mobile/pull/475) · closes [#467](https://github.com/webdriverio/desktop-mobile/issues/467))

### Changed
- Released \@wdio/electron-service@10.2.0-next.2.
- Released \@wdio/electron-service@10.2.0-next.1.
- Released \@wdio/electron-service@10.2.0-next.0.
**Dependencies**:
- Updated minor and patch dependencies including webdriverio 9.29.1→9.30.0, appium 3.5.2→3.6.0, biome 2.5.2→2.5.6, and electron-nightly 44.0.0-nightly.20260701→45.0.0-nightly.20260731. (PR [#573](https://github.com/webdriverio/desktop-mobile/pull/573))
- Updated \@biomejs/biome, \@inquirer/prompts, \@types/node, \@typescript-eslint/parser, \@vitest/eslint-plugin, eslint, globals, lint-staged, ora, turbo, vitest, and \@wdio packages. (PR [#516](https://github.com/webdriverio/desktop-mobile/pull/516) · closes [#517](https://github.com/webdriverio/desktop-mobile/issues/517))
- Updated production dependencies including rollup 4.61.1→4.62.2, esbuild 0.28.0→0.28.1, electron 41.7.2→41.9.2, electron-nightly, puppeteer-core, and \@electron/fuses. (PR [#500](https://github.com/webdriverio/desktop-mobile/pull/500))
- **CDP bridge migration**: Migrated \@wdio/electron-service to use the shared \@wdio/native-cdp-bridge instead of the dedicated \@wdio/electron-cdp-bridge, which is now retired. (PR [#481](https://github.com/webdriverio/desktop-mobile/pull/481))

## [@wdio/flutter-service@1.0.0-next.2] - 2026-08-03

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-flutter-service@v1.0.0-next.1...wdio-flutter-service@v1.0.0-next.2)

### New
- **DevServer auto-start**: Integrated devServer auto-start into all four desktop launchers (Dioxus, Tauri, Electrobun, Electron) with proper URL propagation to worker caps and lifecycle management. (PR [#505](https://github.com/webdriverio/desktop-mobile/pull/505))

### Developer
**Dependencies**:
- Routine dependency updates including WebdriverIO, Appium drivers, Biome, Turbo, Vitest, and Electron nightly. Also fixed the native-mobile-core drift guard that failed to sync Appium driver updates into the runtime matrix. (PR [#573](https://github.com/webdriverio/desktop-mobile/pull/573))
- Routine dependency updates including Biome, ESLint, TypeScript tooling, Vitest, and Turbo. (PR [#516](https://github.com/webdriverio/desktop-mobile/pull/516) · closes [#517](https://github.com/webdriverio/desktop-mobile/issues/517))
- **Code Quality**: Relocated wdio_flutter to packages/flutter-bridge at the top level.

## wdio_flutter@0.1.1-next.0 - 2026-08-03

_First release of wdio_flutter._

### Changed
- Updated version to 0.1.1-next.0
