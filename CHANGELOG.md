# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).



## @wdio/flutter-service@1.0.0-next.0 - 2026-06-24

_First release of @wdio/flutter-service._

### Changed
- **CI**: Disabled pub.dev publishing for wdio_flutter pending the wdio publisher setup.

## [@wdio/electron-cdp-bridge@10.1.0] - 2026-06-23

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-electron-cdp-bridge@v10.0.0...wdio-electron-cdp-bridge@v10.1.0)

### Changed
- **Tooling**: Switched repository scripts to run directly with Node.js instead of tsx, simplifying the development environment. (#345)
- **Dependencies**: Updated project dependencies and resolved a throttling issue with WKWebView on macOS ARM devices.

## [@wdio/electron-service@10.1.0] - 2026-06-23

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-electron-service@v10.0.0...wdio-electron-service@v10.1.0)

### New
- **@wdio/dioxus-service**: Added @wdio/dioxus-service integration branch.
- **Browser mode**: Implemented browser mode phase 3.
- **Browser-only test mode**: Implemented browser-only test mode (Phase 2).

### Fixed
- Fixed user command overrides being overwritten instead of composed in electron-service and tauri-service. (#422, #432, #432, #422)
- Fixed mock-instance type bugs in native-types service modules. (#339)
- Switched to WeakMap for standalone activeLaunchers to prevent memory leaks in electron-service.
- Hardened Windows session teardown to prevent crash or hang on benign errors.
- Addressed deferred lifecycle and log-parsing issues from Dioxus pull request.
- Fixed pure Rust publishing for Tauri.

### Changed
- Batched updateAllMocks calls into a single CDP round-trip for improved performance in electron-service. (#268)
- Added legacy-package downloads badge (≤ v9) to electron downloads.
- Refreshed dependencies and fixed Dioxus macOS-ARM WKWebView throttling issues.
- Reduced log volume and consolidated diagnostics summary in electron-service.
- Added video recording guide and reworked visual-testing documentation.
- Updated logger name in electron service launcher for improved clarity.

### Documentation
- Added visual regression testing guide documentation.
- Updated release management documentation to clarify GitHub release notes policy.

### Developer
- **CI**: Integrated browser-mode E2E and package tests into CI pipeline. (#420)
**Dependencies**:
- Updated 3 production dependencies.
- Updated 9 production dependencies.
- **Tooling**: Changed repository scripts to run on bare Node instead of tsx. (#345)
- **Infrastructure**: Updated release management process.
