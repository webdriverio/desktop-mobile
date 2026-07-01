# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).




## [@wdio/native-utils@2.5.0] - 2026-07-01

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-native-utils@v2.4.0...wdio-native-utils@v2.5.0)

### Fixed
- Fixed user command overrides being silently clobbered by electron-service and tauri-service when both register element-scoped wrappers for the same commands. (PR [#441](https://github.com/webdriverio/desktop-mobile/pull/441) · closes [#422](https://github.com/webdriverio/desktop-mobile/issues/422), [#432](https://github.com/webdriverio/desktop-mobile/issues/432), [#432](https://github.com/webdriverio/desktop-mobile/issues/432), [#422](https://github.com/webdriverio/desktop-mobile/issues/422))

### Changed
- **Tooling**: Updated internal tooling to run repository scripts on bare Node.js instead of tsx, improving type checking coverage for scripts. (PR [#347](https://github.com/webdriverio/desktop-mobile/pull/347) · closes [#345](https://github.com/webdriverio/desktop-mobile/issues/345))
- **Dependencies**: Updated 9 production dependencies including Electron to 41.7.1, rollup to 4.61.1, and puppeteer-core to 25.1.0. (PR [#336](https://github.com/webdriverio/desktop-mobile/pull/336))

## @wdio/flutter-service@1.0.0-next.1 - 2026-06-27

_First release of @wdio/flutter-service._

### Changed
- Updated Flutter manifest files to align with the published 1.0.0-next.0 version.
- **Dependencies**: Removed the custom Flutter driver fork in favor of the official upstream version. (#461)

## [@wdio/tauri-plugin@1.2.0] - 2026-06-25

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-tauri-plugin@v1.1.0...wdio-tauri-plugin@v1.2.0)

### Developer
- **Dependencies**: Bumped cargo dependencies across multiple directories, including 8 updates.

## [@wdio/tauri-service@1.2.0] - 2026-06-25

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-tauri-service@v1.1.0...wdio-tauri-service@v1.2.0)

### Breaking
- **BREAKING** Removed the tauri afterCommand mock-sync feature.

### New
- **BiDi preload**: Added support for capturing startup invoke() calls via BiDi preload in browser mode.

### Fixed
- Fixed command overrides being overwritten instead of properly composed with existing commands. (#422, #432, #432, #422)
- Fixed mock synchronization via afterCommand so user command overrides are preserved. (#422)

### Changed
- **Performance**: Improved mock updates by batching updateAllMocks into a single scheduler for better performance. (#429)

### Documentation
- Updated documentation to reflect the new 'external' naming convention for driver-provider.

### Developer
- **CI**: Integrated browser-mode E2E and package tests into the CI pipeline. (#420)

## [tauri-plugin-wdio-webdriver@1.2.0] - 2026-06-25

### Fixed
- Fixed clicking with options so the correct element is targeted when using pointerMove origin resolution (#423)

### Developer
- **Dependencies**: Bumped cargo dependencies across the project with 8 updates in 5 directories
