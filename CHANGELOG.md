# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [@wdio/tauri-plugin@1.1.0-next.0] - 2026-06-13

[Full Changelog](https://github.com/webdriverio/desktop-mobile.git/compare/wdio-tauri-plugin@v1.0.0...1.1.0-next.0)

### Changed
- **Build System**: Added Cargo.lock to the repository to ensure reproducible Rust builds.
**Dependencies**:
- Updated 9 production dependencies in the main directory.
- Refreshed dependencies to resolve WKWebView throttling on macOS ARM.

### Documentation
- Added release notes for Tauri v1.0.0.

## [@wdio/tauri-service@1.1.0-next.0] - 2026-06-13

[Full Changelog](https://github.com/webdriverio/desktop-mobile.git/compare/wdio-tauri-service@v1.0.0...1.1.0-next.0)

### New
- **@wdio/dioxus-service**: Introduced @wdio/dioxus-service package for Dioxus integration testing support.
- **Browser mode phase 3**: Implemented browser mode Phase 3 with expanded platform support and improved configuration handling.
- **Browser-only test mode**: Added browser-only test mode (Phase 2) for running tests exclusively in browser environments.
- **Browser mode in TauriLaunchService**: Implemented browser mode in TauriLaunchService for launching tests in embedded browser contexts.
- **Interceptor framework**: Added interceptor framework for spying on native operations in Tauri and Electron environments.
- **Early exit handling**: Added early exit handling for the embedded WebDriver server to improve shutdown behavior.

### Fixed
- Fixed type inference for `isMockFunction` to properly detect mock functions across Electron, Tauri, Dioxus, and Electrobun targets.
- Fixed type errors with mock-instance in service modules for native-type integration. (#339)
- Fixed Tauri service to properly honor `appBinaryPath` and trust existing binary paths.
- Fixed deferred lifecycle and log-parsing issues introduced in the Dioxus integration.
- Increased default `startTimeout` from 30s to 60s in Tauri session configuration to accommodate slower environments.

### Changed
- Resolved Dioxus macOS ARM WKWebView throttling issues and refreshed dependencies.
- Reduced log verbosity by demoting per-instance INFO logs to debug level in Tauri service.

### Documentation
- Added video recording guide and overhauled the visual testing documentation.
- Added v1.0.0 release notes documenting Tauri plugin changes and migration guide.
- Added visual regression testing guide covering setup, configuration, and best practices.

### Developer
- **Tooling**: Switched repository scripts to run directly with Node.js instead of tsx for improved compatibility. (#345)
- **Dependencies**: Updated 9 production dependencies across the project for improved stability and compatibility.

## [tauri-plugin-wdio-webdriver@1.1.0-next.0] - 2026-06-13

### Documentation
- Added v1.0.0 release notes

### Developer
- **CI**: Committed Cargo.lock to enable reproducible builds and fix Rust CI
