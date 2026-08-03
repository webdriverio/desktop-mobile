# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [@wdio/tauri-plugin@1.3.0] - 2026-08-03

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-tauri-plugin@v1.2.0...wdio-tauri-plugin@v1.3.0)

### Fixed
- **Turbo cache poisoning**: Fixed turbo cache poisoning issues by using stable chunk names in the bundler, removing redundant build overrides, tracking shared tsconfig.base files in globalDependencies, and adding uniform typecheck coverage in CI. (PR [#519](https://github.com/webdriverio/desktop-mobile/pull/519) · closes [#509](https://github.com/webdriverio/desktop-mobile/issues/509))

### Changed
**Dependencies**:
- Released \@wdio/tauri-plugin, \@wdio/tauri-service, and tauri-plugin-wdio-webdriver at version 1.3.0-next.1.
- Released \@wdio/tauri-plugin, \@wdio/tauri-service, and tauri-plugin-wdio-webdriver at version 1.3.0-next.0.
- Updated npm dependencies including WebdriverIO packages (9.30.0), Appium (3.6.0), Biome (2.5.6), Turbo (2.10.8), Vitest (4.1.10), and ESLint (10.8.0). Also corrected the Appium driver matrix to match package.json versions. (PR [#573](https://github.com/webdriverio/desktop-mobile/pull/573))
- Updated Rust dependencies across Dioxus and Tauri packages, including serde, serde_json, tokio, hyper, anyhow, and uuid across 7 directories. (PR [#537](https://github.com/webdriverio/desktop-mobile/pull/537))
- Updated npm packages including Biome (2.5.2), ESLint (10.6.0), Vitest (4.1.9), Turbo (2.10.2), and WebdriverIO packages (9.29.1). (PR [#516](https://github.com/webdriverio/desktop-mobile/pull/516) · closes [#517](https://github.com/webdriverio/desktop-mobile/issues/517))
- Updated anyhow to 1.0.103 and tauri to 2.11.5 across dioxus-driver, tauri-plugin, and tauri-plugin-webdriver packages. (PR [#515](https://github.com/webdriverio/desktop-mobile/pull/515))
- Updated production dependencies including Rollup (4.62.2), esbuild (0.28.1), Electron (41.9.2), Puppeteer (25.3.0), and Tauri API (2.11.1). (PR [#500](https://github.com/webdriverio/desktop-mobile/pull/500))

### Developer
- **Clippy linting**: Added cargo clippy linting to CI for all first-party Rust crates, running across Linux, Windows, and macOS to ensure platform-specific modules are linted on their target OS. (PR [#557](https://github.com/webdriverio/desktop-mobile/pull/557))

## [@wdio/tauri-service@1.3.0] - 2026-08-03

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-tauri-service@v1.2.0...wdio-tauri-service@v1.3.0)

### New
- **DevServer auto-start**: Integrated devServer auto-start functionality into Dioxus, Tauri, Electron, and Electrobun launchers, enabling automatic dev server management during test runs. (PR [#505](https://github.com/webdriverio/desktop-mobile/pull/505))

### Fixed
- Fixed an issue where the Tauri browser plugin's focus recovery would silently undo window switches made via standard WebDriver commands. (PR [#560](https://github.com/webdriverio/desktop-mobile/pull/560))
- Fixed a macOS 26.4 regression affecting embedded standalone mode tests. (PR [#546](https://github.com/webdriverio/desktop-mobile/pull/546))
- Added validation for browser mode configuration, throwing clear errors for unsupported browser names and unreachable dev servers instead of silent failures. (PR [#490](https://github.com/webdriverio/desktop-mobile/pull/490) · closes [#416](https://github.com/webdriverio/desktop-mobile/issues/416))

### Changed
- Released \@wdio/tauri-plugin, \@wdio/tauri-service, and tauri-plugin-wdio-webdriver at version 1.3.0-next.1.
- Released \@wdio/tauri-plugin, \@wdio/tauri-service, and tauri-plugin-wdio-webdriver at version 1.3.0-next.0.
- Updated various production and development dependencies including WebdriverIO packages, Appium drivers, Biome, Turbo, Vitest, ESLint, and Electron nightlies. (PR [#573](https://github.com/webdriverio/desktop-mobile/pull/573))
- Updated Biome, ESLint, Vitest, Turbo, and several other tooling dependencies to their latest versions. (PR [#516](https://github.com/webdriverio/desktop-mobile/pull/516) · closes [#517](https://github.com/webdriverio/desktop-mobile/issues/517))
- Updated production dependencies including rollup, esbuild, Electron, puppeteer-core, and Tauri API packages. (PR [#500](https://github.com/webdriverio/desktop-mobile/pull/500))

## [tauri-plugin-wdio-webdriver@1.3.0] - 2026-08-03

### Fixed
- Fixed a macOS 26.4 flake where WebKit reclaimed `callAsyncJavaScript` completion handlers mid-flight, causing DirectEval to wait out the full script timeout. Scripts now route their result through a window global for synchronous retrieval. (\#553)
- Fixed `switchToWindow` to clear the frame stack so subsequent commands in the new window no longer incorrectly target frames from the previous window. (\#559)
- Stopped generated schema files from modifying the git tree by fixing a trailing newline in the webdriver plugin schema and excluding all generated schemas from biome formatting. (\#556)
- Fixed malformed fixture CSP that caused WebKit to block IPC custom-protocol fetches, falling back to postMessage IPC which stalls on idle runners. Fixtures now correctly declare `ipc:`, `plugin:`, `tauri:` and `http://ipc.localhost` scheme sources. (\#552)
- Rewrote macOS DirectEval to use a fire-and-forget script pattern with synchronous eval reads, avoiding native completion handlers that WebKit 26.4 reclaims mid-flight. (\#549)
- Corrected diagnosis: the macOS 26.4 regression is in embedded standalone mode, not deeplink mode, which was incorrectly identified. (\#546)
- Fixed W3C Actions tick duration to use the maximum pause across all sources instead of summing them, aligning with the spec's definition of a tick's duration. (\#497, \#496)

### Changed
- Released v1.3.0-next.1 of \@wdio/tauri-plugin, \@wdio/tauri-service, and tauri-plugin-wdio-webdriver
- Released v1.3.0-next.0 of \@wdio/tauri-plugin, \@wdio/tauri-service, and tauri-plugin-wdio-webdriver
- Updated Rust dependencies across multiple packages: serde, serde_json, thiserror, tokio, uuid, anyhow, futures, http-body-util, which, and hyper in dioxus, dioxus-bridge, dioxus-driver, dioxus-embedded-driver, and tauri fixtures. (\#537)
- Updated anyhow to 1.0.103 and tauri to 2.11.5 in dioxus-driver, tauri-plugin, and tauri-plugin-webdriver. (\#515)
- Refactored `performActions` to dispatch actions tick-by-tick across sources rather than serially per source, fixing multi-source sequences like Ctrl+click where modifier keys now stay held during pointer events. (\#492)

### Developer
- **CI**: Added clippy linting to CI for all first-party Rust crates, running on all three OSes to ensure platform-specific modules are linted. Dioxus crates lint on Linux; Tauri crates lint on Linux, Windows, and macOS. (\#557)
