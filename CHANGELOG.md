# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).







## @wdio/native-core@1.0.0 - 2026-06-13

### New
- **@wdio/dioxus-service**: Added new @wdio/dioxus-service package for Dioxus integration.

### Fixed
- Fixed WKWebView throttling issue on macOS ARM platforms.

### Changed
- **Dependencies**: Updated 9 production dependencies to their latest versions.

### Developer
- **Tooling**: Scripts now run on bare Node instead of tsx for improved consistency. (#345)

## [@wdio/native-types@2.3.1] - 2026-06-05

[Full Changelog](https://github.com/webdriverio/desktop-mobile.git/compare/wdio-native-types@v2.3.0...2.3.1)

### Fixed
- Fixed type bugs with mock-instance in service modules. (#339)

## [@wdio/native-spy@1.1.0] - 2026-06-05

[Full Changelog](https://github.com/webdriverio/desktop-mobile.git/compare/wdio-native-spy@v1.0.10...1.1.0)

### New
- **@wdio/dioxus-service**: Added @wdio/dioxus-service for Dioxus integration testing.
- **Browser mode**: Implemented browser mode phase 3 with expanded browser testing capabilities.
- **Browser-only test mode**: Added browser-only test mode (Phase 2) for running tests exclusively in browser environments.
- **Browser mode (Tauri)**: Implemented browser mode in TauriLaunchService for Tauri application testing.
- **Interceptor framework**: Implemented an interceptor framework for Tauri and Electron testing.

### Fixed
- Improved script handling in execute commands for better serialization.

### Changed
- **Dependencies**: Refreshed dependencies and fixed Dioxus macOS-ARM WKWebView throttling issue.
- Improved formatting and organization in configuration files.

## [@wdio/native-utils@2.4.0] - 2026-06-05

[Full Changelog](https://github.com/webdriverio/desktop-mobile.git/compare/wdio-native-utils@v2.3.0...2.4.0)

### New
- **Dioxus service**: Introduced @wdio/dioxus-service for Dioxus integration in WebdriverIO.

### Fixed
- Fixed a crash or hang during Windows session teardown when encountering benign errors.

### Changed
- **Dependencies**: Refreshed project dependencies and resolved a throttling issue affecting Dioxus on macOS ARM with WKWebView.
- Reduced logging volume and consolidated diagnostic summaries for clearer output.
- **Code Quality**: Improved formatting and organization in configuration files.

## [@wdio/native-types@2.3.0] - 2026-06-05

[Full Changelog](https://github.com/webdriverio/desktop-mobile.git/compare/wdio-native-types@v2.2.0...2.3.0)

### New
- **Electrobun service**: Added Electrobun desktop testing support via @wdio/electrobun-service. (#322)
- **Dioxus service**: Added @wdio/dioxus-service for Dioxus integration.
- **Browser mode**: Implemented browser mode phase 3.
- **Browser-only test mode**: Implemented browser-only test mode (Phase 2).
- **Browser mode**: Implemented browser mode in TauriLaunchService.
- **Multi-window support**: Enhanced multi-window support in Tauri.

### Fixed
- Refreshed dependencies and fixed Dioxus macOS-ARM WKWebView throttling issue.
- Improved script handling in execute commands for better serialization.

### Changed
- Updated release configuration.

### Developer
- **Code Quality**: Improved formatting and organization in configuration files.

## [@wdio/tauri-plugin@1.0.0] - 2026-05-03

[Full Changelog](https://github.com/webdriverio/desktop-mobile.git/compare/wdio-tauri-plugin@v1.0.0-next.6...1.0.0)

### Changed
- streamline permissions and command handling in tauri-plugin
- release updates (#250)

## [@wdio/tauri-service@1.0.0] - 2026-05-03

[Full Changelog](https://github.com/webdriverio/desktop-mobile.git/compare/wdio-tauri-service@v1.0.0-next.6...1.0.0)

### Changed
- update plugin-setup documentation to reflect changes in permissions
- release updates (#250)

## [tauri-plugin-wdio-webdriver@1.0.0] - 2026-05-03

### Changed
- release updates (#250)
