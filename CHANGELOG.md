# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).



## @wdio/electrobun-service@0.1.0 - 2026-06-17

_First release of @wdio/electrobun-service._

### New
- **Windows WebView2 CDP support**: Added Windows WebView2 CDP support for non-CEF browser testing.
- **@wdio/electrobun-service**: Added @wdio/electrobun-service for desktop application testing support. (#322)

### Fixed
- Fixed type-guard for isMockFunction to properly handle all framework variants.
- Pinned msedgedriver to WebView2 runtime version to fix Windows test flakiness.

### Changed
- Set electrobun-service version to 0.1.0 for first stable release.
- **@wdio/native-cdp-bridge**: Extracted shared @wdio/native-cdp-bridge module and reworked electrobun to use it. (#333)

### Developer
- **Tooling**: Switched repo scripts to run on bare node instead of tsx. (#345)
- **Dependencies**: Bumped 9 production dependencies across the repository.

## @wdio/dioxus-bridge@1.0.0-next.0 - 2026-06-17

_First release of @wdio/dioxus-bridge._

### New
- **@wdio/dioxus-service**: Introduced @wdio/dioxus-service for Dioxus integration.

### Changed
**Dependencies**:
- Updated cargo dependencies across 4 directories with 4 new versions.
- Updated production dependencies across 1 directory with 9 new versions.
- Refreshed dependencies and resolved a throttling issue with WKWebView on macOS ARM.
- **Build System**: Added Cargo.lock to version control to ensure reproducible Rust builds and stabilize CI.
- **CI**: Added a Docker-based test matrix to verify compatibility across Linux distributions.

## @wdio/dioxus-service@1.0.0-next.0 - 2026-06-17

_First release of @wdio/dioxus-service._

### New
- **@wdio/dioxus-service**: Introduced @wdio/dioxus-service package for Dioxus integration.

### Fixed
- Converged isMockFunction type-guard to handle overloaded types consistently across electron, tauri, dioxus, and electrobun integrations.
- Hardened Windows session teardown to prevent crashes and hangs from benign errors.

### Changed
- Refreshed dependencies and resolved Dioxus WKWebView throttling issues on macOS ARM.

### Documentation
- Added a video recording guide and reworked the visual-testing documentation.

### Developer
- **Tooling**: Switched repository scripts to run on bare Node instead of tsx for simpler execution. (#345)
- **Dependencies**: Bumped 9 production dependencies across the workspace.

## wdio-dioxus-driver@1.0.0-rc.0 - 2026-06-17

_First release of wdio-dioxus-driver._

### New
- **@wdio/dioxus-service**: Introduced @wdio/dioxus-service package for Dioxus integration support.

### Developer
- **Dependencies**: Bumped cargo dependencies across multiple directories for improved stability and compatibility.
- **CI**: Added Cargo.lock to the repository to ensure reproducible Rust builds and resolve CI failures.

## wdio-dioxus-embedded-driver@1.0.0-rc.0 - 2026-06-17

_First release of wdio-dioxus-embedded-driver._

### New
- **@wdio/dioxus-service**: Added new @wdio/dioxus-service package for Dioxus integration testing support.

### Fixed
- Fixed WKWebView throttling on macOS ARM platforms and refreshed dependencies.

### Changed
- **Dependencies**: Updated cargo dependencies across multiple directories for improved stability and compatibility.
- **CI**: Committed Cargo.lock file to enable reproducible builds and fix Rust CI pipeline.
