# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).



## [@wdio/react-native-service@1.0.0-next.1] - 2026-08-03

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-react-native-service@v1.0.0-next.0...wdio-react-native-service@v1.0.0-next.1)

### New
- **DevServer auto-start**: Integrated devServer auto-start functionality into all four browser-mode launchers (Dioxus, Tauri, Electron, Electrobun). Each launcher now automatically starts and manages a dev server when configured, propagates the resolved URL to workers, and handles cleanup on completion. (PR [#505](https://github.com/webdriverio/desktop-mobile/pull/505))

### Changed
- Updated minor and patch dependencies across the workspace, including WebdriverIO packages, Appium drivers, Biome, Turbo, Vitest, and ESLint. (PR [#573](https://github.com/webdriverio/desktop-mobile/pull/573))
- Updated multiple development dependencies including Biome, Inquirer, TypeScript ESLint parser, Vitest, and Turbo. (PR [#516](https://github.com/webdriverio/desktop-mobile/pull/516) · closes [#517](https://github.com/webdriverio/desktop-mobile/issues/517))

### Documentation
- Corrected documentation to clarify that React Native and Flutter services support parallel workers but not multiremote sessions. (PR [#455](https://github.com/webdriverio/desktop-mobile/pull/455))

## [@wdio/dioxus-bridge@1.0.0-next.4] - 2026-08-03

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-dioxus-bridge@v1.0.0-next.3...wdio-dioxus-bridge@v1.0.0-next.4)

### Changed
**Dependencies**:
- Updated minor and patch npm dependencies including webdriverio (9.30.0), appium (3.6.0), biome (2.5.6), turbo (2.10.8), vitest (4.1.10), eslint (10.8.0), and electron-nightly (45.0.0-nightly.20260731). Fixed an Appium driver matrix drift by syncing e2e/package.json changes. (PR [#573](https://github.com/webdriverio/desktop-mobile/pull/573))
- Bumped Rust dependencies across dioxus fixtures and packages: serde, serde_json, tokio, thiserror, uuid, anyhow, futures, http-body-util, which, and hyper. (PR [#537](https://github.com/webdriverio/desktop-mobile/pull/537))
- Updated npm dependencies including biome (2.5.2), eslint (10.6.0), vitest (4.1.9), turbo (2.10.2), typescript-eslint parser (8.62.1), and electron-builder (26.15.3). (PR [#516](https://github.com/webdriverio/desktop-mobile/pull/516) · closes [#517](https://github.com/webdriverio/desktop-mobile/issues/517))
- Bumped Rust dependencies: anyhow (1.0.103) and tauri (2.11.5) across dioxus-driver and tauri-plugin packages. (PR [#515](https://github.com/webdriverio/desktop-mobile/pull/515))
- Updated production dependencies: rollup (4.62.2), esbuild (0.28.1), electron (41.9.2), puppeteer-core (25.3.0), smol-toml (1.7.0), and \@tauri-apps/api (2.11.1). (PR [#500](https://github.com/webdriverio/desktop-mobile/pull/500))
- Bumped Rust dependencies across five directories. (PR [#483](https://github.com/webdriverio/desktop-mobile/pull/483))

### Developer
- **Clippy CI**: Added cargo clippy linting to CI for all first-party Rust crates. Clippy now runs across Linux, Windows, and macOS to ensure platform-specific modules are linted on every OS. (PR [#557](https://github.com/webdriverio/desktop-mobile/pull/557))

## [@wdio/dioxus-service@1.0.0-next.4] - 2026-08-03

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-dioxus-service@v1.0.0-next.3...wdio-dioxus-service@v1.0.0-next.4)

### New
- **DevServer auto-start**: Integrated automatic dev server startup into all four browser-mode launchers (Dioxus, Tauri, Electron, Electrobun) with proper lifecycle management and URL propagation to worker processes. (PR [#505](https://github.com/webdriverio/desktop-mobile/pull/505))
- **W3C Actions API**: Implemented W3C Actions API in the Dioxus embedded driver, enabling pointer, keyboard, and wheel actions through synthesized DOM events. (PR [#488](https://github.com/webdriverio/desktop-mobile/pull/488) · closes [#427](https://github.com/webdriverio/desktop-mobile/issues/427), [#472](https://github.com/webdriverio/desktop-mobile/issues/472), [#416](https://github.com/webdriverio/desktop-mobile/issues/416))

### Fixed
- Fixed browser mode to throw clear errors when using unsupported browser names or when the dev server is unreachable, instead of failing silently or cryptically. (PR [#490](https://github.com/webdriverio/desktop-mobile/pull/490) · closes [#416](https://github.com/webdriverio/desktop-mobile/issues/416))

### Developer
**Dependencies**:
- Updated minor and patch dependencies across the workspace, including WebdriverIO, Appium, Biome, Turbo, Vitest, and ESLint packages. (PR [#573](https://github.com/webdriverio/desktop-mobile/pull/573))
- Updated various development dependencies including Biome, ESLint, Vitest, Turbo, and TypeScript tooling to their latest versions. (PR [#516](https://github.com/webdriverio/desktop-mobile/pull/516) · closes [#517](https://github.com/webdriverio/desktop-mobile/issues/517))
- **Testing**: Added integration and E2E test coverage for Dioxus browser mode to match Electron and Tauri parity. (PR [#489](https://github.com/webdriverio/desktop-mobile/pull/489) · closes [#472](https://github.com/webdriverio/desktop-mobile/issues/472))
- **CI**: Integrated browser-mode E2E and package tests into CI workflows for Electron, Tauri, and Dioxus. (PR [#419](https://github.com/webdriverio/desktop-mobile/pull/419) · closes [#420](https://github.com/webdriverio/desktop-mobile/issues/420))

## [wdio-dioxus-driver@1.0.0-next.4] - 2026-08-03

### Changed
- Updated Rust dependencies across multiple packages including serde, tokio, hyper, uuid, and futures. (\#537)
- Updated Rust dependencies including anyhow and tauri. (\#515)
- Updated Rust dependencies across multiple packages. (\#483)

## [wdio-dioxus-embedded-driver@1.0.0-next.4] - 2026-08-03

### New
- **W3C Actions API**: Implemented the W3C Actions API in the embedded driver, enabling commands like element.click with button options, doubleClick, moveTo, and drag-and-drop. (\#488, \#427, \#472, \#416)

### Fixed
- Fixed tick duration calculation to use the maximum pause duration across all sources instead of summing them, aligning with W3C WebDriver Actions specification. (\#497, \#496)
- Fixed synthesis of auxclick events for non-primary mouse buttons and added position-guarding for contextmenu events on right-button drags. (\#495, \#494)

### Developer
**Dependencies**:
- Updated multiple Rust dependencies including serde, serde_json, tokio, uuid, thiserror, anyhow, futures, and hyper across various packages. (\#537)
- Updated anyhow to 1.0.103 and tauri to 2.11.5 across affected packages. (\#515)
- Updated multiple Rust dependencies across affected packages. (\#483)
