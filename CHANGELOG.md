# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [Unreleased]

### Fixed
- **tauri**: cancel standalone startup and WebDriver requests with `abortSignal`, await embedded process exit during cleanup, preserve startup and cleanup error causes, and defer external driver setup in embedded mode.

## [@wdio/tauri-plugin@1.4.0] - 2026-09-06

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-tauri-plugin@v1.3.0...wdio-tauri-plugin@v1.4.0)

### Changed
- **deps**: bump the production-dependencies group across 1 directory with 16 updates (PR [#627](https://github.com/webdriverio/desktop-mobile/pull/627))
- **deps-dev**: bump the development-dependencies group across 1 directory with 24 updates (PR [#628](https://github.com/webdriverio/desktop-mobile/pull/628))
- **deps**: bump the cargo-dependencies group across 5 directories with 10 updates (PR [#616](https://github.com/webdriverio/desktop-mobile/pull/616))
- update dependencies across multiple packages (incl. major versions) (PR [#585](https://github.com/webdriverio/desktop-mobile/pull/585))

## [@wdio/tauri-service@1.4.0] - 2026-09-06

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-tauri-service@v1.3.0...wdio-tauri-service@v1.4.0)

### Added
- **tauri**: match msedgedriver to a fixed-version WebView2 runtime ([#539](https://github.com/webdriverio/desktop-mobile/issues/539)) (PR [#630](https://github.com/webdriverio/desktop-mobile/pull/630))

### Changed
- **deps**: bump the production-dependencies group across 1 directory with 16 updates (PR [#627](https://github.com/webdriverio/desktop-mobile/pull/627))
- **deps-dev**: bump the development-dependencies group across 1 directory with 24 updates (PR [#628](https://github.com/webdriverio/desktop-mobile/pull/628))
- update dependencies across multiple packages (incl. major versions) (PR [#585](https://github.com/webdriverio/desktop-mobile/pull/585))

### Fixed
- **tauri**: keep CrabNebula log capture for the backend's lifetime (PR [#626](https://github.com/webdriverio/desktop-mobile/pull/626) · closes [#179](https://github.com/webdriverio/desktop-mobile/issues/179))
- **diagnostics**: resolve Linux deps by soname via ldconfig, not dpkg package names ([#617](https://github.com/webdriverio/desktop-mobile/issues/617)) (PR [#621](https://github.com/webdriverio/desktop-mobile/pull/621))
- **tauri**: don't report tauri-driver missing under driverProvider 'embedded' ([#618](https://github.com/webdriverio/desktop-mobile/issues/618)) (PR [#619](https://github.com/webdriverio/desktop-mobile/pull/619))

## [tauri-plugin-wdio-webdriver@1.4.0] - 2026-09-06

### Changed
- **deps**: bump the cargo-dependencies group across 5 directories with 10 updates (\#616)

### Fixed
- **tauri**: use CSS pixels for embedded window rect (\#527)

## wdio_flutter@0.2.0 - 2026-09-06

_First release of wdio_flutter._

### Changed
- Update version to 0.2.0

## [@wdio/electrobun-service@0.2.0] - 2026-09-06

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-electrobun-service@v0.1.0...wdio-electrobun-service@v0.2.0)

### Added
- **electrobun**: Linux support via the native WebKitGTK renderer (W3C WebDriver) (PR [#631](https://github.com/webdriverio/desktop-mobile/pull/631))
- **browser-mode**: wire devServer auto-start into the four launchers ([#417](https://github.com/webdriverio/desktop-mobile/issues/417)) (PR [#505](https://github.com/webdriverio/desktop-mobile/pull/505))

### Changed
- **deps-dev**: bump the development-dependencies group across 1 directory with 24 updates (PR [#628](https://github.com/webdriverio/desktop-mobile/pull/628))
- remove agent-os (salvage architecture docs + ADRs first) (PR [#586](https://github.com/webdriverio/desktop-mobile/pull/586))
- **deps**: update minor and patch dependencies (PR [#573](https://github.com/webdriverio/desktop-mobile/pull/573))
- **deps**: update package versions across multiple packages (PR [#516](https://github.com/webdriverio/desktop-mobile/pull/516) · closes [#517](https://github.com/webdriverio/desktop-mobile/issues/517))

## [@wdio/electron-service@10.3.0] - 2026-09-06

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-electron-service@v10.2.0...wdio-electron-service@v10.3.0)

### Added
- **electron**: resolve the Chromium version from the app binary when the map can't ([#578](https://github.com/webdriverio/desktop-mobile/issues/578)) (PR [#625](https://github.com/webdriverio/desktop-mobile/pull/625))

### Changed
- **deps**: bump the production-dependencies group across 1 directory with 16 updates (PR [#627](https://github.com/webdriverio/desktop-mobile/pull/627))
- **deps-dev**: bump the development-dependencies group across 1 directory with 24 updates (PR [#628](https://github.com/webdriverio/desktop-mobile/pull/628))
- update dependencies across multiple packages (incl. major versions) (PR [#585](https://github.com/webdriverio/desktop-mobile/pull/585))

### Fixed
- **diagnostics**: resolve Linux deps by soname via ldconfig, not dpkg package names ([#617](https://github.com/webdriverio/desktop-mobile/issues/617)) (PR [#621](https://github.com/webdriverio/desktop-mobile/pull/621))
- **electron**: distinguish unknown Electron version from unknown Chromium version (PR [#579](https://github.com/webdriverio/desktop-mobile/pull/579))

## [@wdio/native-cdp-bridge@1.2.0] - 2026-09-06

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-native-cdp-bridge@v1.1.0...wdio-native-cdp-bridge@v1.2.0)

### Changed
- **deps**: bump the production-dependencies group across 1 directory with 16 updates (PR [#627](https://github.com/webdriverio/desktop-mobile/pull/627))
- **deps-dev**: bump the development-dependencies group across 1 directory with 24 updates (PR [#628](https://github.com/webdriverio/desktop-mobile/pull/628))

## [@wdio/native-core@1.2.0] - 2026-09-06

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-native-core@v1.1.0...wdio-native-core@v1.2.0)

### Changed
- **deps-dev**: bump the development-dependencies group across 1 directory with 24 updates (PR [#628](https://github.com/webdriverio/desktop-mobile/pull/628))

## [@wdio/native-spy@1.3.0] - 2026-09-06

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-native-spy@v1.2.0...wdio-native-spy@v1.3.0)

### Changed
- **deps-dev**: bump the development-dependencies group across 1 directory with 24 updates (PR [#628](https://github.com/webdriverio/desktop-mobile/pull/628))

## [@wdio/native-utils@2.7.0] - 2026-09-06

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-native-utils@v2.6.0...wdio-native-utils@v2.7.0)

### Added
- **electron**: resolve the Chromium version from the app binary when the map can't ([#578](https://github.com/webdriverio/desktop-mobile/issues/578)) (PR [#625](https://github.com/webdriverio/desktop-mobile/pull/625))
- **electrobun**: Linux support via the native WebKitGTK renderer (W3C WebDriver) (PR [#631](https://github.com/webdriverio/desktop-mobile/pull/631))

### Changed
- **deps**: bump the production-dependencies group across 1 directory with 16 updates (PR [#627](https://github.com/webdriverio/desktop-mobile/pull/627))
- **deps-dev**: bump the development-dependencies group across 1 directory with 24 updates (PR [#628](https://github.com/webdriverio/desktop-mobile/pull/628))
- update dependencies across multiple packages (incl. major versions) (PR [#585](https://github.com/webdriverio/desktop-mobile/pull/585))

### Fixed
- **diagnostics**: resolve Linux deps by soname via ldconfig, not dpkg package names ([#617](https://github.com/webdriverio/desktop-mobile/issues/617)) (PR [#621](https://github.com/webdriverio/desktop-mobile/pull/621))
