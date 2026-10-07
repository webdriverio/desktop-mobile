# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [@wdio/tauri-plugin@1.5.0] - 2026-10-07

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-tauri-plugin@v1.4.0...wdio-tauri-plugin@v1.5.0)

### Changed
- **deps-dev**: bump the development-dependencies group with 6 updates (PR [#714](https://github.com/webdriverio/desktop-mobile/pull/714))
- **deps**: bump the cargo-dependencies group across 6 directories with 2 updates (PR [#715](https://github.com/webdriverio/desktop-mobile/pull/715))
- **release**: revert the unpublished [#642](https://github.com/webdriverio/desktop-mobile/issues/642) release and fix standing-PR selection (PR [#707](https://github.com/webdriverio/desktop-mobile/pull/707))
- **rust**: run the Tauri and Dioxus driver tests in CI and ban Listener::once (PR [#705](https://github.com/webdriverio/desktop-mobile/pull/705))
- release 17 package(s) (PR [#642](https://github.com/webdriverio/desktop-mobile/pull/642))
- **deps**: bump the production-dependencies group across 1 directory with 14 updates (PR [#698](https://github.com/webdriverio/desktop-mobile/pull/698))
- **deps**: bump the cargo-dependencies group across 5 directories with 5 updates (PR [#700](https://github.com/webdriverio/desktop-mobile/pull/700))
- **deps-dev**: bump the development-dependencies group across 1 directory with 19 updates (PR [#699](https://github.com/webdriverio/desktop-mobile/pull/699))
- **deps**: bump the cargo-dependencies group across 2 directories with 1 update (PR [#682](https://github.com/webdriverio/desktop-mobile/pull/682))
- **deps-dev**: bump the development-dependencies group with 8 updates (PR [#681](https://github.com/webdriverio/desktop-mobile/pull/681))
- align engines.node floor with the WDIO v9 requirement (>=18.20.0) (PR [#653](https://github.com/webdriverio/desktop-mobile/pull/653))
- **deps**: bump the cargo-dependencies group across 4 directories with 1 update (PR [#646](https://github.com/webdriverio/desktop-mobile/pull/646))
- update deps (PR [#648](https://github.com/webdriverio/desktop-mobile/pull/648))

## [@wdio/tauri-service@1.5.0] - 2026-10-07

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-tauri-service@v1.4.0...wdio-tauri-service@v1.5.0)

### Changed
- **release**: revert the unpublished [#642](https://github.com/webdriverio/desktop-mobile/issues/642) release and fix standing-PR selection (PR [#707](https://github.com/webdriverio/desktop-mobile/pull/707))
- release 17 package(s) (PR [#642](https://github.com/webdriverio/desktop-mobile/pull/642))
- **deps**: bump the production-dependencies group across 1 directory with 14 updates (PR [#698](https://github.com/webdriverio/desktop-mobile/pull/698))
- **deps-dev**: bump the development-dependencies group across 1 directory with 19 updates (PR [#699](https://github.com/webdriverio/desktop-mobile/pull/699))
- share standalone teardown helpers (failStartup, safeDeleteSession, boundedOnComplete) (PR [#678](https://github.com/webdriverio/desktop-mobile/pull/678) · closes [#668](https://github.com/webdriverio/desktop-mobile/issues/668))
- **deps-dev**: bump the development-dependencies group with 8 updates (PR [#681](https://github.com/webdriverio/desktop-mobile/pull/681))
- **electron,tauri**: remove deprecated logging aliases, reduce test repetition (PR [#677](https://github.com/webdriverio/desktop-mobile/pull/677))
- add \@repo/test-utils and migrate cold-import/defer/platform helpers (PR [#664](https://github.com/webdriverio/desktop-mobile/pull/664))
- import once in a beforeAll to fix the index.spec cold-import flake (PR [#662](https://github.com/webdriverio/desktop-mobile/pull/662))
- update deps (PR [#648](https://github.com/webdriverio/desktop-mobile/pull/648))

### Fixed
- **tauri**: evaluate tauri.execute on the session's own embedded port (PR [#702](https://github.com/webdriverio/desktop-mobile/pull/702) · closes [#694](https://github.com/webdriverio/desktop-mobile/issues/694))
- **tauri,electron,dioxus**: stop restoring mocks after the session is deleted (PR [#686](https://github.com/webdriverio/desktop-mobile/pull/686) · closes [#685](https://github.com/webdriverio/desktop-mobile/issues/685))
- **tauri**: guarantee teardown on failed standalone startup and await embedded cleanup (PR [#636](https://github.com/webdriverio/desktop-mobile/pull/636))

## [tauri-plugin-wdio-webdriver@1.5.0] - 2026-10-07

### Changed
- **deps**: bump the cargo-dependencies group across 6 directories with 2 updates (\#715)
- **release**: revert the unpublished \#642 release and fix standing-PR selection (\#707)
- **rust**: run the Tauri and Dioxus driver tests in CI and ban Listener::once (\#705)
- release 17 package(s) (\#642)
- **deps**: bump the cargo-dependencies group across 5 directories with 5 updates (\#700)
- **deps**: bump the cargo-dependencies group across 2 directories with 1 update (\#682)
- **deps**: bump the cargo-dependencies group across 4 directories with 1 update (\#646)

### Fixed
- **tauri**: wait for the window's actual state after a window change (\#706)
- **tauri**: stop the embedded driver panicking when a window event repeats (\#704)
- **tauri**: build the webdriver plugin against any Tauri 2 webview2-com (\#687)

## [@wdio/flutter-service@1.0.0-next.3] - 2026-10-07

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-flutter-service@v1.0.0-next.2...wdio-flutter-service@v1.0.0-next.3)

### Changed
- **release**: revert the unpublished [#642](https://github.com/webdriverio/desktop-mobile/issues/642) release and fix standing-PR selection (PR [#707](https://github.com/webdriverio/desktop-mobile/pull/707))
- release 17 package(s) (PR [#642](https://github.com/webdriverio/desktop-mobile/pull/642))
- **deps**: bump the production-dependencies group across 1 directory with 14 updates (PR [#698](https://github.com/webdriverio/desktop-mobile/pull/698))
- **deps-dev**: bump the development-dependencies group across 1 directory with 19 updates (PR [#699](https://github.com/webdriverio/desktop-mobile/pull/699))
- share standalone teardown helpers (failStartup, safeDeleteSession, boundedOnComplete) (PR [#678](https://github.com/webdriverio/desktop-mobile/pull/678) · closes [#668](https://github.com/webdriverio/desktop-mobile/issues/668))
- **deps-dev**: bump the development-dependencies group with 8 updates (PR [#681](https://github.com/webdriverio/desktop-mobile/pull/681))
- **flutter**: execute is handler-only — drop the planned-eval framing ([#389](https://github.com/webdriverio/desktop-mobile/issues/389))
- update deps (PR [#648](https://github.com/webdriverio/desktop-mobile/pull/648))
- **deps**: bump the production-dependencies group across 1 directory with 16 updates (PR [#627](https://github.com/webdriverio/desktop-mobile/pull/627))
- **deps-dev**: bump the development-dependencies group across 1 directory with 24 updates (PR [#628](https://github.com/webdriverio/desktop-mobile/pull/628))
- update dependencies across multiple packages (incl. major versions) (PR [#585](https://github.com/webdriverio/desktop-mobile/pull/585))

## [@wdio/electrobun-service@0.3.0] - 2026-10-07

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-electrobun-service@v0.2.0...wdio-electrobun-service@v0.3.0)

### Added
- **electrobun**: parallel Linux workers & multiremote (PR [#635](https://github.com/webdriverio/desktop-mobile/pull/635))

### Changed
- **release**: revert the unpublished [#642](https://github.com/webdriverio/desktop-mobile/issues/642) release and fix standing-PR selection (PR [#707](https://github.com/webdriverio/desktop-mobile/pull/707))
- release 17 package(s) (PR [#642](https://github.com/webdriverio/desktop-mobile/pull/642))
- **deps-dev**: bump the development-dependencies group across 1 directory with 19 updates (PR [#699](https://github.com/webdriverio/desktop-mobile/pull/699))
- share standalone teardown helpers (failStartup, safeDeleteSession, boundedOnComplete) (PR [#678](https://github.com/webdriverio/desktop-mobile/pull/678) · closes [#668](https://github.com/webdriverio/desktop-mobile/issues/668))
- **deps-dev**: bump the development-dependencies group with 8 updates (PR [#681](https://github.com/webdriverio/desktop-mobile/pull/681))
- **electrobun**: lead deleteSessionBounded comment with what it does (PR [#675](https://github.com/webdriverio/desktop-mobile/pull/675))
- add \@repo/test-utils and migrate cold-import/defer/platform helpers (PR [#664](https://github.com/webdriverio/desktop-mobile/pull/664))
- import once in a beforeAll to fix the index.spec cold-import flake (PR [#662](https://github.com/webdriverio/desktop-mobile/pull/662))
- **tauri,electrobun**: de-elevate Windows msedgedriver E2E via gsudo, reap orphaned Electrobun procs ([#542](https://github.com/webdriverio/desktop-mobile/issues/542)) (PR [#637](https://github.com/webdriverio/desktop-mobile/pull/637))
- update deps (PR [#648](https://github.com/webdriverio/desktop-mobile/pull/648))

### Fixed
- **electrobun**: reap spawned app when standalone onWorkerStart fails (PR [#666](https://github.com/webdriverio/desktop-mobile/pull/666) · closes [#658](https://github.com/webdriverio/desktop-mobile/issues/658))

## [@wdio/electron-service@10.4.0] - 2026-10-07

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-electron-service@v10.3.0...wdio-electron-service@v10.4.0)

### Changed
- **deps-dev**: bump the development-dependencies group with 6 updates (PR [#714](https://github.com/webdriverio/desktop-mobile/pull/714))
- **release**: revert the unpublished [#642](https://github.com/webdriverio/desktop-mobile/issues/642) release and fix standing-PR selection (PR [#707](https://github.com/webdriverio/desktop-mobile/pull/707))
- release 17 package(s) (PR [#642](https://github.com/webdriverio/desktop-mobile/pull/642))
- **deps**: bump the production-dependencies group across 1 directory with 14 updates (PR [#698](https://github.com/webdriverio/desktop-mobile/pull/698))
- **deps-dev**: bump the development-dependencies group across 1 directory with 19 updates (PR [#699](https://github.com/webdriverio/desktop-mobile/pull/699))
- share standalone teardown helpers (failStartup, safeDeleteSession, boundedOnComplete) (PR [#678](https://github.com/webdriverio/desktop-mobile/pull/678) · closes [#668](https://github.com/webdriverio/desktop-mobile/issues/668))
- **deps-dev**: bump the development-dependencies group with 8 updates (PR [#681](https://github.com/webdriverio/desktop-mobile/pull/681))
- **electron,tauri**: remove deprecated logging aliases, reduce test repetition (PR [#677](https://github.com/webdriverio/desktop-mobile/pull/677))
- add \@repo/test-utils and migrate cold-import/defer/platform helpers (PR [#664](https://github.com/webdriverio/desktop-mobile/pull/664))
- update deps (PR [#648](https://github.com/webdriverio/desktop-mobile/pull/648))

### Fixed
- **tauri,electron,dioxus**: stop restoring mocks after the session is deleted (PR [#686](https://github.com/webdriverio/desktop-mobile/pull/686) · closes [#685](https://github.com/webdriverio/desktop-mobile/issues/685))
- **electron**: correct how the Electron version is passed to WebdriverIO (PR [#693](https://github.com/webdriverio/desktop-mobile/pull/693))
- **electron**: stop browser-mode dev server on standalone failure and cleanup (PR [#667](https://github.com/webdriverio/desktop-mobile/pull/667) · closes [#660](https://github.com/webdriverio/desktop-mobile/issues/660))

## [@wdio/native-cdp-bridge@1.3.0] - 2026-10-07

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-native-cdp-bridge@v1.2.0...wdio-native-cdp-bridge@v1.3.0)

### Changed
- **deps-dev**: bump the development-dependencies group with 6 updates (PR [#714](https://github.com/webdriverio/desktop-mobile/pull/714))
- **release**: revert the unpublished [#642](https://github.com/webdriverio/desktop-mobile/issues/642) release and fix standing-PR selection (PR [#707](https://github.com/webdriverio/desktop-mobile/pull/707))
- release 17 package(s) (PR [#642](https://github.com/webdriverio/desktop-mobile/pull/642))
- **deps**: bump the production-dependencies group across 1 directory with 14 updates (PR [#698](https://github.com/webdriverio/desktop-mobile/pull/698))
- **deps-dev**: bump the development-dependencies group across 1 directory with 19 updates (PR [#699](https://github.com/webdriverio/desktop-mobile/pull/699))
- **deps-dev**: bump the development-dependencies group with 8 updates (PR [#681](https://github.com/webdriverio/desktop-mobile/pull/681))
- add \@repo/test-utils and migrate cold-import/defer/platform helpers (PR [#664](https://github.com/webdriverio/desktop-mobile/pull/664))
- import once in a beforeAll to fix the index.spec cold-import flake (PR [#662](https://github.com/webdriverio/desktop-mobile/pull/662))
- update deps (PR [#648](https://github.com/webdriverio/desktop-mobile/pull/648))

## [@wdio/native-core@1.3.0] - 2026-10-07

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-native-core@v1.2.0...wdio-native-core@v1.3.0)

### Changed
- **release**: revert the unpublished [#642](https://github.com/webdriverio/desktop-mobile/issues/642) release and fix standing-PR selection (PR [#707](https://github.com/webdriverio/desktop-mobile/pull/707))
- release 17 package(s) (PR [#642](https://github.com/webdriverio/desktop-mobile/pull/642))
- **deps-dev**: bump the development-dependencies group across 1 directory with 19 updates (PR [#699](https://github.com/webdriverio/desktop-mobile/pull/699))
- **deps-dev**: bump the development-dependencies group with 8 updates (PR [#681](https://github.com/webdriverio/desktop-mobile/pull/681))
- **electron,tauri**: remove deprecated logging aliases, reduce test repetition (PR [#677](https://github.com/webdriverio/desktop-mobile/pull/677))
- align engines.node floor with the WDIO v9 requirement (>=18.20.0) (PR [#653](https://github.com/webdriverio/desktop-mobile/pull/653))
- update deps (PR [#648](https://github.com/webdriverio/desktop-mobile/pull/648))

## [@wdio/native-mobile-core@1.2.0] - 2026-10-07

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-native-mobile-core@v1.1.0...wdio-native-mobile-core@v1.2.0)

### Changed
- **release**: revert the unpublished [#642](https://github.com/webdriverio/desktop-mobile/issues/642) release and fix standing-PR selection (PR [#707](https://github.com/webdriverio/desktop-mobile/pull/707))
- release 17 package(s) (PR [#642](https://github.com/webdriverio/desktop-mobile/pull/642))
- **deps-dev**: bump the development-dependencies group across 1 directory with 19 updates (PR [#699](https://github.com/webdriverio/desktop-mobile/pull/699))
- share standalone teardown helpers (failStartup, safeDeleteSession, boundedOnComplete) (PR [#678](https://github.com/webdriverio/desktop-mobile/pull/678) · closes [#668](https://github.com/webdriverio/desktop-mobile/issues/668))
- **deps-dev**: bump the development-dependencies group with 8 updates (PR [#681](https://github.com/webdriverio/desktop-mobile/pull/681))
- add \@repo/test-utils and migrate cold-import/defer/platform helpers (PR [#664](https://github.com/webdriverio/desktop-mobile/pull/664))
- align engines.node floor with the WDIO v9 requirement (>=18.20.0) (PR [#653](https://github.com/webdriverio/desktop-mobile/pull/653))
- update deps (PR [#648](https://github.com/webdriverio/desktop-mobile/pull/648))
- **deps-dev**: bump the development-dependencies group across 1 directory with 24 updates (PR [#628](https://github.com/webdriverio/desktop-mobile/pull/628))
- **react-native**: exercise iOS boot-cap defaults on the RN-iOS leg ([#428](https://github.com/webdriverio/desktop-mobile/issues/428)) (PR [#624](https://github.com/webdriverio/desktop-mobile/pull/624))
- update dependencies across multiple packages (incl. major versions) (PR [#585](https://github.com/webdriverio/desktop-mobile/pull/585))

### Fixed
- **react-native**: stop Metro on standalone cleanup/failure (native-mobile-core onComplete) (PR [#663](https://github.com/webdriverio/desktop-mobile/pull/663))
- **flutter**: unpin appium-flutter-driver, move to ^3.10.1 (PR [#622](https://github.com/webdriverio/desktop-mobile/pull/622) · closes [#604](https://github.com/webdriverio/desktop-mobile/issues/604))
- **mobile**: sync the xcuitest matrix row with the pinned driver (PR [#581](https://github.com/webdriverio/desktop-mobile/pull/581))

## [@wdio/native-spy@1.4.0] - 2026-10-07

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-native-spy@v1.3.0...wdio-native-spy@v1.4.0)

### Changed
- **release**: revert the unpublished [#642](https://github.com/webdriverio/desktop-mobile/issues/642) release and fix standing-PR selection (PR [#707](https://github.com/webdriverio/desktop-mobile/pull/707))
- release 17 package(s) (PR [#642](https://github.com/webdriverio/desktop-mobile/pull/642))
- **deps-dev**: bump the development-dependencies group across 1 directory with 19 updates (PR [#699](https://github.com/webdriverio/desktop-mobile/pull/699))
- **deps-dev**: bump the development-dependencies group with 8 updates (PR [#681](https://github.com/webdriverio/desktop-mobile/pull/681))
- align engines.node floor with the WDIO v9 requirement (>=18.20.0) (PR [#653](https://github.com/webdriverio/desktop-mobile/pull/653))
- update deps (PR [#648](https://github.com/webdriverio/desktop-mobile/pull/648))

## [@wdio/native-types@2.6.0] - 2026-10-07

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-native-types@v2.5.0...wdio-native-types@v2.6.0)

### Changed
- **release**: revert the unpublished [#642](https://github.com/webdriverio/desktop-mobile/issues/642) release and fix standing-PR selection (PR [#707](https://github.com/webdriverio/desktop-mobile/pull/707))
- release 17 package(s) (PR [#642](https://github.com/webdriverio/desktop-mobile/pull/642))
- **deps-dev**: bump the development-dependencies group across 1 directory with 19 updates (PR [#699](https://github.com/webdriverio/desktop-mobile/pull/699))
- **deps-dev**: bump the development-dependencies group with 8 updates (PR [#681](https://github.com/webdriverio/desktop-mobile/pull/681))
- **flutter**: execute is handler-only — drop the planned-eval framing ([#389](https://github.com/webdriverio/desktop-mobile/issues/389))
- align engines.node floor with the WDIO v9 requirement (>=18.20.0) (PR [#653](https://github.com/webdriverio/desktop-mobile/pull/653))
- update deps (PR [#648](https://github.com/webdriverio/desktop-mobile/pull/648))
- **deps**: bump the production-dependencies group across 1 directory with 16 updates (PR [#627](https://github.com/webdriverio/desktop-mobile/pull/627))
- **deps-dev**: bump the development-dependencies group across 1 directory with 24 updates (PR [#628](https://github.com/webdriverio/desktop-mobile/pull/628))

### Fixed
- **electron**: correct how the Electron version is passed to WebdriverIO (PR [#693](https://github.com/webdriverio/desktop-mobile/pull/693))
- **native-types**: model appium:* tuning keys on ReactNativeCapabilities (PR [#605](https://github.com/webdriverio/desktop-mobile/pull/605) · closes [#574](https://github.com/webdriverio/desktop-mobile/issues/574))

## [@wdio/native-utils@2.8.0] - 2026-10-07

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-native-utils@v2.7.0...wdio-native-utils@v2.8.0)

### Changed
- **release**: revert the unpublished [#642](https://github.com/webdriverio/desktop-mobile/issues/642) release and fix standing-PR selection (PR [#707](https://github.com/webdriverio/desktop-mobile/pull/707))
- release 17 package(s) (PR [#642](https://github.com/webdriverio/desktop-mobile/pull/642))
- **deps**: bump the production-dependencies group across 1 directory with 14 updates (PR [#698](https://github.com/webdriverio/desktop-mobile/pull/698))
- **deps-dev**: bump the development-dependencies group across 1 directory with 19 updates (PR [#699](https://github.com/webdriverio/desktop-mobile/pull/699))
- share standalone teardown helpers (failStartup, safeDeleteSession, boundedOnComplete) (PR [#678](https://github.com/webdriverio/desktop-mobile/pull/678) · closes [#668](https://github.com/webdriverio/desktop-mobile/issues/668))
- **deps-dev**: bump the development-dependencies group with 8 updates (PR [#681](https://github.com/webdriverio/desktop-mobile/pull/681))
- add \@repo/test-utils and migrate cold-import/defer/platform helpers (PR [#664](https://github.com/webdriverio/desktop-mobile/pull/664))
- align engines.node floor with the WDIO v9 requirement (>=18.20.0) (PR [#653](https://github.com/webdriverio/desktop-mobile/pull/653))
- update deps (PR [#648](https://github.com/webdriverio/desktop-mobile/pull/648))

## [@wdio/react-native-service@1.0.0-next.2] - 2026-10-07

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-react-native-service@v1.0.0-next.1...wdio-react-native-service@v1.0.0-next.2)

### Changed
- **release**: revert the unpublished [#642](https://github.com/webdriverio/desktop-mobile/issues/642) release and fix standing-PR selection (PR [#707](https://github.com/webdriverio/desktop-mobile/pull/707))
- release 17 package(s) (PR [#642](https://github.com/webdriverio/desktop-mobile/pull/642))
- **deps**: bump the production-dependencies group across 1 directory with 14 updates (PR [#698](https://github.com/webdriverio/desktop-mobile/pull/698))
- **deps-dev**: bump the development-dependencies group across 1 directory with 19 updates (PR [#699](https://github.com/webdriverio/desktop-mobile/pull/699))
- share standalone teardown helpers (failStartup, safeDeleteSession, boundedOnComplete) (PR [#678](https://github.com/webdriverio/desktop-mobile/pull/678) · closes [#668](https://github.com/webdriverio/desktop-mobile/issues/668))
- **deps-dev**: bump the development-dependencies group with 8 updates (PR [#681](https://github.com/webdriverio/desktop-mobile/pull/681))
- update deps (PR [#648](https://github.com/webdriverio/desktop-mobile/pull/648))
- **deps**: bump the production-dependencies group across 1 directory with 16 updates (PR [#627](https://github.com/webdriverio/desktop-mobile/pull/627))
- **deps-dev**: bump the development-dependencies group across 1 directory with 24 updates (PR [#628](https://github.com/webdriverio/desktop-mobile/pull/628))
- update dependencies across multiple packages (incl. major versions) (PR [#585](https://github.com/webdriverio/desktop-mobile/pull/585))

### Fixed
- **native-types**: model appium:* tuning keys on ReactNativeCapabilities (PR [#605](https://github.com/webdriverio/desktop-mobile/pull/605) · closes [#574](https://github.com/webdriverio/desktop-mobile/issues/574))
