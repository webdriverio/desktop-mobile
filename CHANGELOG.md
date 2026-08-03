# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


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
