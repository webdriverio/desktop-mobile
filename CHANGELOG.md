# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).


## [@wdio/dioxus-bridge@1.1.0] - 2026-10-09

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-dioxus-bridge@v1.0.0...wdio-dioxus-bridge@v1.1.0)

### Changed
- **deps**: bump the cargo-dependencies group across 6 directories with 2 updates (PR [#715](https://github.com/webdriverio/desktop-mobile/pull/715))
- **release**: revert the unpublished [#642](https://github.com/webdriverio/desktop-mobile/issues/642) release and fix standing-PR selection (PR [#707](https://github.com/webdriverio/desktop-mobile/pull/707))
- release 17 package(s) (PR [#642](https://github.com/webdriverio/desktop-mobile/pull/642))
- **deps**: bump the production-dependencies group across 1 directory with 14 updates (PR [#698](https://github.com/webdriverio/desktop-mobile/pull/698))
- **deps-dev**: bump the development-dependencies group across 1 directory with 19 updates (PR [#699](https://github.com/webdriverio/desktop-mobile/pull/699))
- **deps-dev**: bump the development-dependencies group with 8 updates (PR [#681](https://github.com/webdriverio/desktop-mobile/pull/681))
- align engines.node floor with the WDIO v9 requirement (>=18.20.0) (PR [#653](https://github.com/webdriverio/desktop-mobile/pull/653))
- **deps**: bump the cargo-dependencies group across 4 directories with 1 update (PR [#646](https://github.com/webdriverio/desktop-mobile/pull/646))
- update deps (PR [#648](https://github.com/webdriverio/desktop-mobile/pull/648))
- **deps**: bump the production-dependencies group across 1 directory with 16 updates (PR [#627](https://github.com/webdriverio/desktop-mobile/pull/627))
- **deps-dev**: bump the development-dependencies group across 1 directory with 24 updates (PR [#628](https://github.com/webdriverio/desktop-mobile/pull/628))
- **deps**: bump the cargo-dependencies group across 5 directories with 10 updates (PR [#616](https://github.com/webdriverio/desktop-mobile/pull/616))
- **deps**: bump the cargo-dependencies group across 2 directories with 3 updates (PR [#599](https://github.com/webdriverio/desktop-mobile/pull/599))
- update dependencies across multiple packages (incl. major versions) (PR [#585](https://github.com/webdriverio/desktop-mobile/pull/585))

### Fixed
- **dioxus**: make the setup docs and errors match what v1 supports (embedded driver only) (PR [#703](https://github.com/webdriverio/desktop-mobile/pull/703))

## [@wdio/dioxus-service@1.1.0] - 2026-10-09

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-dioxus-service@v1.0.0...wdio-dioxus-service@v1.1.0)

### Changed
- **release**: revert the unpublished [#642](https://github.com/webdriverio/desktop-mobile/issues/642) release and fix standing-PR selection (PR [#707](https://github.com/webdriverio/desktop-mobile/pull/707))
- release 17 package(s) (PR [#642](https://github.com/webdriverio/desktop-mobile/pull/642))
- **deps-dev**: bump the development-dependencies group across 1 directory with 19 updates (PR [#699](https://github.com/webdriverio/desktop-mobile/pull/699))
- share standalone teardown helpers (failStartup, safeDeleteSession, boundedOnComplete) (PR [#678](https://github.com/webdriverio/desktop-mobile/pull/678) · closes [#668](https://github.com/webdriverio/desktop-mobile/issues/668))
- **deps-dev**: bump the development-dependencies group with 8 updates (PR [#681](https://github.com/webdriverio/desktop-mobile/pull/681))
- add \@repo/test-utils and migrate cold-import/defer/platform helpers (PR [#664](https://github.com/webdriverio/desktop-mobile/pull/664))
- import once in a beforeAll to fix the index.spec cold-import flake (PR [#662](https://github.com/webdriverio/desktop-mobile/pull/662))
- align engines.node floor with the WDIO v9 requirement (>=18.20.0) (PR [#653](https://github.com/webdriverio/desktop-mobile/pull/653))
- **dioxus**: de-version-pin service docs (PR [#651](https://github.com/webdriverio/desktop-mobile/pull/651) · closes [#647](https://github.com/webdriverio/desktop-mobile/issues/647))
- update deps (PR [#648](https://github.com/webdriverio/desktop-mobile/pull/648))
- **deps-dev**: bump the development-dependencies group across 1 directory with 24 updates (PR [#628](https://github.com/webdriverio/desktop-mobile/pull/628))

### Fixed
- **dioxus**: start the embedded driver only under the service, and say why startup failed (PR [#710](https://github.com/webdriverio/desktop-mobile/pull/710))
- **dioxus**: make the setup docs and errors match what v1 supports (embedded driver only) (PR [#703](https://github.com/webdriverio/desktop-mobile/pull/703))
- **tauri,electron,dioxus**: stop restoring mocks after the session is deleted (PR [#686](https://github.com/webdriverio/desktop-mobile/pull/686) · closes [#685](https://github.com/webdriverio/desktop-mobile/issues/685))
- **dioxus**: reap already-spawned embedded drivers on a later instance's pre-spawn failure (PR [#670](https://github.com/webdriverio/desktop-mobile/pull/670) · closes [#669](https://github.com/webdriverio/desktop-mobile/issues/669))

## [wdio-dioxus-driver@1.1.0] - 2026-10-09

### Changed
- **deps**: bump the cargo-dependencies group across 6 directories with 2 updates (\#715)
- **release**: revert the unpublished \#642 release and fix standing-PR selection (\#707)
- release 17 package(s) (\#642)
- **deps**: bump the cargo-dependencies group across 5 directories with 5 updates (\#700)
- **deps**: bump the cargo-dependencies group across 5 directories with 10 updates (\#616)

### Fixed
- **dioxus**: make the setup docs and errors match what v1 supports (embedded driver only) (\#703)

## [wdio-dioxus-embedded-driver@1.1.0] - 2026-10-09

### Changed
- **deps**: bump the cargo-dependencies group across 6 directories with 2 updates (\#715)
- **release**: revert the unpublished \#642 release and fix standing-PR selection (\#707)
- release 17 package(s) (\#642)
- **deps**: bump the cargo-dependencies group across 5 directories with 5 updates (\#700)
- **deps**: bump the cargo-dependencies group across 4 directories with 1 update (\#646)
- **deps**: bump the cargo-dependencies group across 5 directories with 10 updates (\#616)
- **deps**: bump the cargo-dependencies group across 2 directories with 3 updates (\#599)

### Fixed
- **dioxus**: start the embedded driver only under the service, and say why startup failed (\#710)
- **dioxus**: make the setup docs and errors match what v1 supports (embedded driver only) (\#703)

## [@wdio/native-types@2.6.1] - 2026-10-09

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-native-types@v2.6.0...wdio-native-types@v2.6.1)

### Fixed
- **dioxus**: make the setup docs and errors match what v1 supports (embedded driver only) (PR [#703](https://github.com/webdriverio/desktop-mobile/pull/703))
