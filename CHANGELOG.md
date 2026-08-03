# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).




## [@wdio/native-core@1.1.0] - 2026-08-03

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-native-core@v1.0.0...wdio-native-core@v1.1.0)

### New
- **Managed dev server**: Wired dev server auto-start into all four browser-mode launchers (Dioxus, Tauri, Electron, Electrobun). Each launcher now automatically starts the configured dev server, waits for it to be ready, propagates the URL to workers, and tears it down on completion. (PR [#505](https://github.com/webdriverio/desktop-mobile/pull/505))
- **Managed dev server**: Added DevServerProcess class and startManagedDevServer orchestrator to native-core, providing shared infrastructure for spawning, polling, and tearing down dev server processes with proper process-tree cleanup on all platforms. (PR [#503](https://github.com/webdriverio/desktop-mobile/pull/503))

### Fixed
- Browser mode now throws a clear error when configured with a non-Chrome browser instead of silently overwriting it. Also added a preflight check in onPrepare that fails fast with an actionable message if the dev server is unreachable. (PR [#490](https://github.com/webdriverio/desktop-mobile/pull/490) · closes [#416](https://github.com/webdriverio/desktop-mobile/issues/416))

### Changed
**Dependencies**:
- Updated minor and patch dependencies across the workspace, including webdriverio (9.29.1→9.30.0), appium (^3.5.2→^3.6.0), biome, turbo, vitest, eslint, and electron-nightly. Also synchronized Appium driver versions in the test matrix and applied biome formatting fixes. (PR [#573](https://github.com/webdriverio/desktop-mobile/pull/573))
- Bumped various development dependencies including biome, inquirer, typescript-eslint packages, vitest, eslint, turbo, and electron-builder to their latest versions. (PR [#516](https://github.com/webdriverio/desktop-mobile/pull/516) · closes [#517](https://github.com/webdriverio/desktop-mobile/issues/517))

## [@wdio/electron-service@10.2.0-next.0] - 2026-08-02

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-electron-service@v10.1.0...wdio-electron-service@v10.2.0-next.0)

### New
- **DevServer auto-start**: Dev server now automatically starts before tests run in all four browser-mode launchers (Dioxus, Tauri, Electron, Electrobun). (PR [#505](https://github.com/webdriverio/desktop-mobile/pull/505))

### Fixed
- Browser mode now throws clear errors for unsupported browser names and unreachable dev servers instead of failing silently or late. (PR [#490](https://github.com/webdriverio/desktop-mobile/pull/490) · closes [#416](https://github.com/webdriverio/desktop-mobile/issues/416))
- Fixed an unhandled promise rejection that could crash the worker when MockUpdateScheduler encountered a failed batch. (PR [#475](https://github.com/webdriverio/desktop-mobile/pull/475) · closes [#467](https://github.com/webdriverio/desktop-mobile/issues/467))

### Changed
**Dependencies**:
- Routine minor and patch dependency updates including webdriverio, appium drivers, biome, turbo, vitest, eslint, and electron-nightly. (PR [#573](https://github.com/webdriverio/desktop-mobile/pull/573))
- Updated package versions across multiple packages including biome, inquirer, typescript-eslint, vitest, eslint, and electron-builder. (PR [#516](https://github.com/webdriverio/desktop-mobile/pull/516) · closes [#517](https://github.com/webdriverio/desktop-mobile/issues/517))
- Production dependency updates including rollup, esbuild, electron, puppeteer-core, and tauri-apps API. (PR [#500](https://github.com/webdriverio/desktop-mobile/pull/500))
- Electron service now uses the shared \@wdio/native-cdp-bridge; \@wdio/electron-cdp-bridge has been retired. (PR [#481](https://github.com/webdriverio/desktop-mobile/pull/481))

## [@wdio/tauri-plugin@1.3.0-next.0] - 2026-08-02

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-tauri-plugin@v1.2.0...wdio-tauri-plugin@v1.3.0-next.0)

### Fixed
- Fixed turbo cache poisoning by using stable chunk names, removing the bundler build override, tracking shared tsconfig.base in globalDependencies, and unifying typecheck coverage. (PR [#519](https://github.com/webdriverio/desktop-mobile/pull/519) · closes [#509](https://github.com/webdriverio/desktop-mobile/issues/509))

### Developer
**Dependencies**:
- Updated minor and patch dependencies across the workspace, including WebdriverIO, Appium drivers, Biome, Turbo, Vitest, ESLint, and Electron nightly. (PR [#573](https://github.com/webdriverio/desktop-mobile/pull/573))
- Bumped Rust dependencies (serde, serde_json, tokio, thiserror, uuid, anyhow, futures, http-body-util, which, hyper) across multiple Dioxus and fixture packages. (PR [#537](https://github.com/webdriverio/desktop-mobile/pull/537))
- Updated npm package versions including Biome, Inquirer, TypeScript ESLint plugins, Vitest plugin, ESLint, Turbo, and WebdriverIO packages. (PR [#516](https://github.com/webdriverio/desktop-mobile/pull/516) · closes [#517](https://github.com/webdriverio/desktop-mobile/issues/517))
- Updated Rust dependencies (anyhow, tauri) in Dioxus and Tauri plugin packages. (PR [#515](https://github.com/webdriverio/desktop-mobile/pull/515))
- Updated production dependencies including Rollup, esbuild, Electron, Puppeteer, and Electron nightlies. (PR [#500](https://github.com/webdriverio/desktop-mobile/pull/500))
- **Clippy CI linting**: Added CI linting with cargo clippy for Rust crates on Linux, macOS, and Windows, ensuring platform-specific modules are consistently linted. (PR [#557](https://github.com/webdriverio/desktop-mobile/pull/557))

## [@wdio/tauri-service@1.3.0-next.0] - 2026-08-02

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-tauri-service@v1.2.0...wdio-tauri-service@v1.3.0-next.0)

### New
- **DevServer auto-start**: Integrated devServer auto-start into all four desktop launchers (Dioxus, Tauri, Electrobun, Electron), automatically starting dev servers before test execution and propagating the URL to browser workers. (PR [#505](https://github.com/webdriverio/desktop-mobile/pull/505))

### Fixed
- Fixed an issue where standard WebDriver `switchToWindow` calls could silently revert due to automatic focus recovery, undoing explicit window selections. (PR [#560](https://github.com/webdriverio/desktop-mobile/pull/560))
- Fixed the embedded standalone test suite failure on macOS 26.4. (PR [#546](https://github.com/webdriverio/desktop-mobile/pull/546))
- Added validation for browser mode configuration: non-Chrome browser names now throw a clear error, and unreachable dev servers fail early with an actionable message. (PR [#490](https://github.com/webdriverio/desktop-mobile/pull/490) · closes [#416](https://github.com/webdriverio/desktop-mobile/issues/416))

### Changed
**Dependencies**:
- Updated numerous minor and patch dependencies across the workspace, including WebdriverIO packages, Appium drivers, Biome, Turbo, Vitest, ESLint, and Electron nightly. (PR [#573](https://github.com/webdriverio/desktop-mobile/pull/573))
- Updated various development dependencies including Biome, ESLint, TypeScript parser, Vitest, and Turbo. (PR [#516](https://github.com/webdriverio/desktop-mobile/pull/516) · closes [#517](https://github.com/webdriverio/desktop-mobile/issues/517))
- Updated production dependencies including Rollup, esbuild, Electron, Puppeteer, and Tauri API. (PR [#500](https://github.com/webdriverio/desktop-mobile/pull/500))

## [tauri-plugin-wdio-webdriver@1.3.0-next.0] - 2026-08-02

### Fixed
- **macOS 26.4 DirectEval fix**: Fixed a regression on macOS 26.4 where DirectEval timed out due to WebKit intermittently reclaiming the `callAsyncJavaScript` completion handler mid-flight. (\#553)
- Fixed `switchToWindow` to properly reset the frame stack, preventing subsequent commands from incorrectly targeting frames in the old window. (\#559)
- Fixed `cargo build` from leaving the tree dirty by correcting a trailing newline in the webdriver permission schema and excluding generated tauri schemas from biome formatting. (\#556)
- Corrected malformed Content Security Policy in fixtures that was causing macOS DirectEval to fall back to an unreliable postMessage IPC interface. (\#552)
- **macOS DirectEval fire-and-forget**: Refactored the macOS DirectEval path to run scripts fire-and-forget and read results via synchronous evals, avoiding long-held completion handlers that WebKit 26.4 reclaims. (\#549)
- Identified the embedded standalone suite as the actual macOS 26.4 regression target, correcting the initial diagnosis that focused on the deeplink suite. (\#546)
- Fixed tick duration calculation in Actions to use the maximum pause across all sources rather than summing them, aligning with W3C WebDriver spec. (\#497, \#496)

### Changed
- Bumped Cargo dependencies (serde, serde_json, tokio, uuid, thiserror, and others) across 7 directories for improved compatibility and bug fixes. (\#537)
- **Clippy CI for Rust crates**: Added CI linting for first-party Rust crates using `cargo clippy`, running across all three platforms to catch platform-specific module violations. (\#557)
- Bumped Cargo dependencies (anyhow, tauri) across 3 directories for improved compatibility and bug fixes. (\#515)
- **Tick-by-tick Actions processing**: Changed `performActions` to process ticks across all sources concurrently rather than fully draining each source sequentially, fixing multi-source sequences like Ctrl+click. (\#492)
