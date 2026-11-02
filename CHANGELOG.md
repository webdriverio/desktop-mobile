# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).





## [@wdio/dioxus-bridge@2.0.0] - 2026-11-02

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-dioxus-bridge@v1.1.0...wdio-dioxus-bridge@v2.0.0)

### Changed
- **BREAKING** require Node.js 22.23.4, 24.22.1 or 26.12.1 on every package (PR [#916](https://github.com/webdriverio/desktop-mobile/pull/916))
- **dioxus-bridge**: rebuild the committed guest-js bundle (PR [#861](https://github.com/webdriverio/desktop-mobile/pull/861))
- **biome**: require braces around if, else and loop bodies (PR [#851](https://github.com/webdriverio/desktop-mobile/pull/851))
- update deps (PR [#803](https://github.com/webdriverio/desktop-mobile/pull/803))
- **BREAKING** require Node.js 22.19 on every package (PR [#797](https://github.com/webdriverio/desktop-mobile/pull/797))
- **BREAKING** **dioxus**: remove the bridge's with-bridge feature (PR [#719](https://github.com/webdriverio/desktop-mobile/pull/719))
- check Rust formatting with rustfmt (PR [#727](https://github.com/webdriverio/desktop-mobile/pull/727))

### Fixed
- CI follow-ups for the dependency update (PR [#829](https://github.com/webdriverio/desktop-mobile/pull/829))

## [@wdio/dioxus-service@2.0.0] - 2026-11-02

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-dioxus-service@v1.1.0...wdio-dioxus-service@v2.0.0)

### Added
- **BREAKING** **dioxus**: add mock.withImplementation (PR [#901](https://github.com/webdriverio/desktop-mobile/pull/901))
- **native-utils**: add shared severeServiceError(message, cause) helper (PR [#835](https://github.com/webdriverio/desktop-mobile/pull/835))

### Changed
- share runThenSync between the Tauri, Dioxus and Electron mocks (PR [#917](https://github.com/webdriverio/desktop-mobile/pull/917))
- **dioxus**: correct appBinaryPath's precedence and tighten the appArgs note (PR [#959](https://github.com/webdriverio/desktop-mobile/pull/959))
- **BREAKING** require Node.js 22.23.4, 24.22.1 or 26.12.1 on every package (PR [#916](https://github.com/webdriverio/desktop-mobile/pull/916))
- share the multiremote wiring helpers (normaliseInstanceCaps, forEachInstance) (PR [#900](https://github.com/webdriverio/desktop-mobile/pull/900))
- test Dioxus on Weston as well as Xvfb (PR [#840](https://github.com/webdriverio/desktop-mobile/pull/840))
- **native-utils**: move the error helpers out of the teardown module (PR [#856](https://github.com/webdriverio/desktop-mobile/pull/856))
- **dioxus**: fold platform support into the quick start (PR [#834](https://github.com/webdriverio/desktop-mobile/pull/834))
- **biome**: require braces around if, else and loop bodies (PR [#851](https://github.com/webdriverio/desktop-mobile/pull/851))
- use WebdriverIO v10's display server (PR [#809](https://github.com/webdriverio/desktop-mobile/pull/809))
- **BREAKING** take webdriverio and \@wdio/* as optional peers (PR [#798](https://github.com/webdriverio/desktop-mobile/pull/798))
- **BREAKING** require Node.js 22.19 on every package (PR [#797](https://github.com/webdriverio/desktop-mobile/pull/797))

### Fixed
- **BREAKING** **dioxus,tauri,electrobun,electron,native-core,native-types**: resolve browser mode per capability (PR [#953](https://github.com/webdriverio/desktop-mobile/pull/953) · closes [#944](https://github.com/webdriverio/desktop-mobile/issues/944))
- **dioxus**: return each instance's result from execute on the multiremote root (PR [#955](https://github.com/webdriverio/desktop-mobile/pull/955))
- **BREAKING** **dioxus**: resolve driverProvider for each capability (PR [#949](https://github.com/webdriverio/desktop-mobile/pull/949))
- **BREAKING** **dioxus,native-types**: pass 'dioxus:options'.args to the app and drop webviewOptions (PR [#946](https://github.com/webdriverio/desktop-mobile/pull/946) · closes [#938](https://github.com/webdriverio/desktop-mobile/issues/938))
- **BREAKING** **dioxus**: give each multiremote instance its own mocks (PR [#921](https://github.com/webdriverio/desktop-mobile/pull/921) · closes [#905](https://github.com/webdriverio/desktop-mobile/issues/905))
- typecheck the services against WebdriverIO v9's getInstance() types (PR [#918](https://github.com/webdriverio/desktop-mobile/pull/918) · closes [#903](https://github.com/webdriverio/desktop-mobile/issues/903))
- **BREAKING** await async withImplementation callbacks and correct execute's types and docs (PR [#896](https://github.com/webdriverio/desktop-mobile/pull/896))
- **BREAKING** standalone init() stops tying connectionRetryTimeout to startTimeout, and cleanup() runs one order (PR [#883](https://github.com/webdriverio/desktop-mobile/pull/883))
- **native-core**: reject concurrent use of an active managed dev server (PR [#864](https://github.com/webdriverio/desktop-mobile/pull/864))
- **tauri,dioxus**: honour global startTimeout and log options in standalone init() (PR [#816](https://github.com/webdriverio/desktop-mobile/pull/816))
- CI follow-ups for the dependency update (PR [#829](https://github.com/webdriverio/desktop-mobile/pull/829))
- **BREAKING** **tauri,dioxus**: allocate embedded instance ports with get-port (PR [#807](https://github.com/webdriverio/desktop-mobile/pull/807))
- support WebdriverIO v10's multiremote flag and command options (PR [#792](https://github.com/webdriverio/desktop-mobile/pull/792))
- take \@wdio/logger as a peer so services share the WebdriverIO log file (PR [#724](https://github.com/webdriverio/desktop-mobile/pull/724))
- finish mock and driver teardown after a failure, then report it (PR [#744](https://github.com/webdriverio/desktop-mobile/pull/744) · closes [#683](https://github.com/webdriverio/desktop-mobile/issues/683))

## [wdio-dioxus-driver@2.0.0] - 2026-11-02

### Changed
- check Rust formatting with rustfmt (\#727)

### Fixed
- CI follow-ups for the dependency update (\#829)

## [wdio-dioxus-embedded-driver@2.0.0] - 2026-11-02

### Added
- **BREAKING** **tauri,dioxus**: move focus on Tab in the embedded drivers, and press Tab for a tab character (\#924)

### Changed
- **dioxus**: drop the claim that the external provider supports screenshots (\#960)
- check Rust formatting with rustfmt (\#727)

### Fixed
- **BREAKING** **tauri,dioxus**: send and type the shifted character with Shift held in the embedded drivers (\#919, \#894)
- **BREAKING** **dioxus**: press special keys in Element Send Keys instead of writing them into the element (\#922, \#912)
- **BREAKING** **dioxus**: type, delete and break lines from key actions in the embedded driver (\#920, \#906)
- **BREAKING** **tauri,dioxus**: click a focused button on Enter and Space in the embedded drivers (\#910)
- **BREAKING** **tauri,dioxus**: submit an input's form on Enter in the embedded drivers (\#898)
- **BREAKING** **dioxus**: send browser key codes, Shift, and newline and backspace as keys (\#897, \#888)
- **BREAKING** **dioxus**: fail screenshots as unsupported instead of returning a blank image (\#891, \#739)
- **BREAKING** **dioxus**: fire change when focus leaves, not during Clear and Send Keys (\#871)
- CI follow-ups for the dependency update (\#829)

## [wdio-dioxus@2.0.0] - 2026-11-02

### Changed
- **deps**: bump the cargo-dependencies group across 2 directories with 3 updates (\#818)
- check Rust formatting with rustfmt (\#727)

## [@wdio/tauri-plugin@2.0.0] - 2026-11-02

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-tauri-plugin@v1.5.1...wdio-tauri-plugin@v2.0.0)

### Changed
- **BREAKING** require Node.js 22.23.4, 24.22.1 or 26.12.1 on every package (PR [#916](https://github.com/webdriverio/desktop-mobile/pull/916))
- **deps**: bump the cargo-dependencies group across 2 directories with 3 updates (PR [#818](https://github.com/webdriverio/desktop-mobile/pull/818))
- update deps (PR [#803](https://github.com/webdriverio/desktop-mobile/pull/803))
- **BREAKING** **tauri**: one tested tauri floor, ^2.10 (PR [#799](https://github.com/webdriverio/desktop-mobile/pull/799))
- **BREAKING** require Node.js 22.19 on every package (PR [#797](https://github.com/webdriverio/desktop-mobile/pull/797))
- check Rust formatting with rustfmt (PR [#727](https://github.com/webdriverio/desktop-mobile/pull/727))

### Fixed
- **BREAKING** await async withImplementation callbacks and correct execute's types and docs (PR [#896](https://github.com/webdriverio/desktop-mobile/pull/896))
- **BREAKING** **native-types**: narrow TauriAPIs to the core.invoke that execute passes (PR [#860](https://github.com/webdriverio/desktop-mobile/pull/860) · closes [#859](https://github.com/webdriverio/desktop-mobile/issues/859))
- **BREAKING** **tauri**: emit triggerDeeplink's event on the app's main thread (PR [#857](https://github.com/webdriverio/desktop-mobile/pull/857))
- CI follow-ups for the dependency update (PR [#829](https://github.com/webdriverio/desktop-mobile/pull/829))

## [@wdio/tauri-service@2.0.0] - 2026-11-02

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-tauri-service@v1.5.1...wdio-tauri-service@v2.0.0)

### Added
- **native-utils**: add shared severeServiceError(message, cause) helper (PR [#835](https://github.com/webdriverio/desktop-mobile/pull/835))

### Changed
- share runThenSync between the Tauri, Dioxus and Electron mocks (PR [#917](https://github.com/webdriverio/desktop-mobile/pull/917))
- **BREAKING** require Node.js 22.23.4, 24.22.1 or 26.12.1 on every package (PR [#916](https://github.com/webdriverio/desktop-mobile/pull/916))
- share the multiremote wiring helpers (normaliseInstanceCaps, forEachInstance) (PR [#900](https://github.com/webdriverio/desktop-mobile/pull/900))
- **tauri**: stub describeDisplay in the launcher integration tests (PR [#895](https://github.com/webdriverio/desktop-mobile/pull/895))
- **tauri**: test Tauri on Weston as well as Xvfb (PR [#879](https://github.com/webdriverio/desktop-mobile/pull/879))
- **native-utils**: move the error helpers out of the teardown module (PR [#856](https://github.com/webdriverio/desktop-mobile/pull/856))
- **tauri**: fold platform support into the quick start (PR [#837](https://github.com/webdriverio/desktop-mobile/pull/837))
- format the CI flake log and Tauri configuration page (PR [#854](https://github.com/webdriverio/desktop-mobile/pull/854))
- **tauri**: clarify startTimeout and logLevel (PR [#839](https://github.com/webdriverio/desktop-mobile/pull/839))
- **biome**: require braces around if, else and loop bodies (PR [#851](https://github.com/webdriverio/desktop-mobile/pull/851))
- use WebdriverIO v10's display server (PR [#809](https://github.com/webdriverio/desktop-mobile/pull/809))
- **BREAKING** **native-types,tauri**: remove the unused commandTimeout option (PR [#832](https://github.com/webdriverio/desktop-mobile/pull/832))
- update deps (PR [#803](https://github.com/webdriverio/desktop-mobile/pull/803))
- **tauri**: drop the redundant triggerDeeplink provider fallback (PR [#811](https://github.com/webdriverio/desktop-mobile/pull/811))
- **BREAKING** **tauri**: one tested tauri floor, ^2.10 (PR [#799](https://github.com/webdriverio/desktop-mobile/pull/799))
- **BREAKING** **tauri**: pick the triggerDeeplink path from the worker's provider (PR [#804](https://github.com/webdriverio/desktop-mobile/pull/804) · closes [#701](https://github.com/webdriverio/desktop-mobile/issues/701))
- **BREAKING** **tauri,native-types**: remove driverProvider 'official' and the unused command helpers (PR [#802](https://github.com/webdriverio/desktop-mobile/pull/802))
- **BREAKING** take webdriverio and \@wdio/* as optional peers (PR [#798](https://github.com/webdriverio/desktop-mobile/pull/798))
- **BREAKING** require Node.js 22.19 on every package (PR [#797](https://github.com/webdriverio/desktop-mobile/pull/797))

### Fixed
- **BREAKING** **dioxus,tauri,electrobun,electron,native-core,native-types**: resolve browser mode per capability (PR [#953](https://github.com/webdriverio/desktop-mobile/pull/953) · closes [#944](https://github.com/webdriverio/desktop-mobile/issues/944))
- **BREAKING** **tauri,native-types**: type tauri:options.webviewOptions as msedgedriver's WebView2 options (PR [#958](https://github.com/webdriverio/desktop-mobile/pull/958))
- **BREAKING** **native-types,tauri**: accept rootDir only on the Electron service (PR [#947](https://github.com/webdriverio/desktop-mobile/pull/947) · closes [#945](https://github.com/webdriverio/desktop-mobile/issues/945))
- **BREAKING** **tauri**: give each multiremote instance its own windowLabel and reject mixed driver providers (PR [#950](https://github.com/webdriverio/desktop-mobile/pull/950))
- **BREAKING** **tauri**: apply each multiremote instance's own mock options to its mocks (PR [#930](https://github.com/webdriverio/desktop-mobile/pull/930))
- typecheck the services against WebdriverIO v9's getInstance() types (PR [#918](https://github.com/webdriverio/desktop-mobile/pull/918) · closes [#903](https://github.com/webdriverio/desktop-mobile/issues/903))
- **BREAKING** await async withImplementation callbacks and correct execute's types and docs (PR [#896](https://github.com/webdriverio/desktop-mobile/pull/896))
- **BREAKING** **tauri**: give each multiremote instance its own mocks (PR [#899](https://github.com/webdriverio/desktop-mobile/pull/899) · closes [#849](https://github.com/webdriverio/desktop-mobile/issues/849))
- **BREAKING** standalone init() stops tying connectionRetryTimeout to startTimeout, and cleanup() runs one order (PR [#883](https://github.com/webdriverio/desktop-mobile/pull/883))
- **BREAKING** **native-types**: narrow TauriAPIs to the core.invoke that execute passes (PR [#860](https://github.com/webdriverio/desktop-mobile/pull/860) · closes [#859](https://github.com/webdriverio/desktop-mobile/issues/859))
- **tauri**: make native-mode emitEvent reach the app's listeners (PR [#858](https://github.com/webdriverio/desktop-mobile/pull/858))
- **tauri,native-utils**: report a Wayland display in the launcher logs and say which variable is set (PR [#890](https://github.com/webdriverio/desktop-mobile/pull/890))
- **native-core**: reject concurrent use of an active managed dev server (PR [#864](https://github.com/webdriverio/desktop-mobile/pull/864))
- **BREAKING** **tauri**: emit triggerDeeplink's event on the app's main thread (PR [#857](https://github.com/webdriverio/desktop-mobile/pull/857))
- **BREAKING** **tauri**: deliver triggerDeeplink to the app's deep-link handler (PR [#826](https://github.com/webdriverio/desktop-mobile/pull/826) · closes [#805](https://github.com/webdriverio/desktop-mobile/issues/805))
- **tauri,dioxus**: honour global startTimeout and log options in standalone init() (PR [#816](https://github.com/webdriverio/desktop-mobile/pull/816))
- **tauri**: honour logLevel for tauri-driver output (PR [#825](https://github.com/webdriverio/desktop-mobile/pull/825))
- CI follow-ups for the dependency update (PR [#829](https://github.com/webdriverio/desktop-mobile/pull/829))
- **BREAKING** **tauri,dioxus**: allocate embedded instance ports with get-port (PR [#807](https://github.com/webdriverio/desktop-mobile/pull/807))
- **tauri**: treat an unset driverProvider as embedded in the worker (PR [#806](https://github.com/webdriverio/desktop-mobile/pull/806))
- **tauri,electron**: stop calling executeAsync, which WebdriverIO v10 removed (PR [#794](https://github.com/webdriverio/desktop-mobile/pull/794))
- support WebdriverIO v10's multiremote flag and command options (PR [#792](https://github.com/webdriverio/desktop-mobile/pull/792))
- take \@wdio/logger as a peer so services share the WebdriverIO log file (PR [#724](https://github.com/webdriverio/desktop-mobile/pull/724))
- finish mock and driver teardown after a failure, then report it (PR [#744](https://github.com/webdriverio/desktop-mobile/pull/744) · closes [#683](https://github.com/webdriverio/desktop-mobile/issues/683))

## [tauri-plugin-wdio-webdriver@2.0.0] - 2026-11-02

### Added
- **BREAKING** **tauri,dioxus**: move focus on Tab in the embedded drivers, and press Tab for a tab character (\#924)

### Changed
- **tauri**: disable unused objc2 default features (\#865)
- **tauri**: fold platform support into the quick start (\#837)
- **deps**: bump the cargo-dependencies group across 2 directories with 3 updates (\#818)
- **BREAKING** **tauri,native-types**: remove driverProvider 'official' and the unused command helpers (\#802)
- check Rust formatting with rustfmt (\#727)

### Fixed
- **BREAKING** **tauri,dioxus**: send and type the shifted character with Shift held in the embedded drivers (\#919, \#894)
- **BREAKING** **tauri,dioxus**: click a focused button on Enter and Space in the embedded drivers (\#910)
- **BREAKING** **tauri,dioxus**: submit an input's form on Enter in the embedded drivers (\#898)
- **BREAKING** **tauri**: send browser key codes for printable keys (\#828, \#756)
- **BREAKING** **dioxus**: fire change when focus leaves, not during Clear and Send Keys (\#871)
- **BREAKING** **tauri**: fire change when focus leaves a field or Enter commits it, not during Send Keys (\#827, \#738)
- CI follow-ups for the dependency update (\#829)
- **tauri**: run macOS async scripts through the polling sync path (\#796)

## [@wdio/flutter-service@1.0.0-next.5] - 2026-11-02

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-flutter-service@v1.0.0-next.4...wdio-flutter-service@v1.0.0-next.5)

### Changed
- **BREAKING** require Node.js 22.23.4, 24.22.1 or 26.12.1 on every package (PR [#916](https://github.com/webdriverio/desktop-mobile/pull/916))
- **biome**: require braces around if, else and loop bodies (PR [#851](https://github.com/webdriverio/desktop-mobile/pull/851))
- **BREAKING** take webdriverio and \@wdio/* as optional peers (PR [#798](https://github.com/webdriverio/desktop-mobile/pull/798))
- **BREAKING** require Node.js 22.19 on every package (PR [#797](https://github.com/webdriverio/desktop-mobile/pull/797))

### Fixed
- CI follow-ups for the dependency update (PR [#829](https://github.com/webdriverio/desktop-mobile/pull/829))
- support WebdriverIO v10's multiremote flag and command options (PR [#792](https://github.com/webdriverio/desktop-mobile/pull/792))
- finish mock and driver teardown after a failure, then report it (PR [#744](https://github.com/webdriverio/desktop-mobile/pull/744) · closes [#683](https://github.com/webdriverio/desktop-mobile/issues/683))

## [@wdio/electrobun-service@0.4.0] - 2026-11-02

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-electrobun-service@v0.3.1...wdio-electrobun-service@v0.4.0)

### Added
- **native-utils**: add shared severeServiceError(message, cause) helper (PR [#835](https://github.com/webdriverio/desktop-mobile/pull/835))

### Changed
- **BREAKING** require Node.js 22.23.4, 24.22.1 or 26.12.1 on every package (PR [#916](https://github.com/webdriverio/desktop-mobile/pull/916))
- share the multiremote wiring helpers (normaliseInstanceCaps, forEachInstance) (PR [#900](https://github.com/webdriverio/desktop-mobile/pull/900))
- **native-utils**: move the error helpers out of the teardown module (PR [#856](https://github.com/webdriverio/desktop-mobile/pull/856))
- **biome**: require braces around if, else and loop bodies (PR [#851](https://github.com/webdriverio/desktop-mobile/pull/851))
- **BREAKING** take webdriverio and \@wdio/* as optional peers (PR [#798](https://github.com/webdriverio/desktop-mobile/pull/798))
- **BREAKING** require Node.js 22.19 on every package (PR [#797](https://github.com/webdriverio/desktop-mobile/pull/797))

### Fixed
- **BREAKING** **dioxus,tauri,electrobun,electron,native-core,native-types**: resolve browser mode per capability (PR [#953](https://github.com/webdriverio/desktop-mobile/pull/953) · closes [#944](https://github.com/webdriverio/desktop-mobile/issues/944))
- **BREAKING** **electrobun**: resolve the CDP connection options and mode per multiremote instance (PR [#948](https://github.com/webdriverio/desktop-mobile/pull/948))
- **BREAKING** **electrobun**: apply the clearMocks, resetMocks and restoreMocks options before each test (PR [#933](https://github.com/webdriverio/desktop-mobile/pull/933))
- **BREAKING** await async withImplementation callbacks and correct execute's types and docs (PR [#896](https://github.com/webdriverio/desktop-mobile/pull/896))
- **BREAKING** standalone init() stops tying connectionRetryTimeout to startTimeout, and cleanup() runs one order (PR [#883](https://github.com/webdriverio/desktop-mobile/pull/883))
- **native-core**: reject concurrent use of an active managed dev server (PR [#864](https://github.com/webdriverio/desktop-mobile/pull/864))
- CI follow-ups for the dependency update (PR [#829](https://github.com/webdriverio/desktop-mobile/pull/829))
- **electrobun**: keep Linux apps on X11, starting Xvfb only without an X display (PR [#795](https://github.com/webdriverio/desktop-mobile/pull/795))
- support WebdriverIO v10's multiremote flag and command options (PR [#792](https://github.com/webdriverio/desktop-mobile/pull/792))
- take \@wdio/logger as a peer so services share the WebdriverIO log file (PR [#724](https://github.com/webdriverio/desktop-mobile/pull/724))
- finish mock and driver teardown after a failure, then report it (PR [#744](https://github.com/webdriverio/desktop-mobile/pull/744) · closes [#683](https://github.com/webdriverio/desktop-mobile/issues/683))

## [@wdio/electron-service@11.0.0] - 2026-11-02

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-electron-service@v10.4.1...wdio-electron-service@v11.0.0)

### Added
- **native-utils**: add shared severeServiceError(message, cause) helper (PR [#835](https://github.com/webdriverio/desktop-mobile/pull/835))

### Changed
- share runThenSync between the Tauri, Dioxus and Electron mocks (PR [#917](https://github.com/webdriverio/desktop-mobile/pull/917))
- **BREAKING** require Node.js 22.23.4, 24.22.1 or 26.12.1 on every package (PR [#916](https://github.com/webdriverio/desktop-mobile/pull/916))
- **electron**: test Electron on Weston as well as Xvfb (PR [#876](https://github.com/webdriverio/desktop-mobile/pull/876))
- **native-utils**: move the error helpers out of the teardown module (PR [#856](https://github.com/webdriverio/desktop-mobile/pull/856))
- **biome**: require braces around if, else and loop bodies (PR [#851](https://github.com/webdriverio/desktop-mobile/pull/851))
- use WebdriverIO v10's display server (PR [#809](https://github.com/webdriverio/desktop-mobile/pull/809))
- update deps (PR [#803](https://github.com/webdriverio/desktop-mobile/pull/803))
- **BREAKING** take webdriverio and \@wdio/* as optional peers (PR [#798](https://github.com/webdriverio/desktop-mobile/pull/798))
- **BREAKING** require Node.js 22.19 on every package (PR [#797](https://github.com/webdriverio/desktop-mobile/pull/797))

### Fixed
- **BREAKING** **dioxus,tauri,electrobun,electron,native-core,native-types**: resolve browser mode per capability (PR [#953](https://github.com/webdriverio/desktop-mobile/pull/953) · closes [#944](https://github.com/webdriverio/desktop-mobile/issues/944))
- **BREAKING** **native-types,tauri**: accept rootDir only on the Electron service (PR [#947](https://github.com/webdriverio/desktop-mobile/pull/947) · closes [#945](https://github.com/webdriverio/desktop-mobile/issues/945))
- **BREAKING** **electron**: apply each multiremote instance's own mode, log capture and deeplink options (PR [#952](https://github.com/webdriverio/desktop-mobile/pull/952))
- **BREAKING** **electron**: give each multiremote instance its own mocks (PR [#923](https://github.com/webdriverio/desktop-mobile/pull/923))
- typecheck the services against WebdriverIO v9's getInstance() types (PR [#918](https://github.com/webdriverio/desktop-mobile/pull/918) · closes [#903](https://github.com/webdriverio/desktop-mobile/issues/903))
- **BREAKING** await async withImplementation callbacks and correct execute's types and docs (PR [#896](https://github.com/webdriverio/desktop-mobile/pull/896))
- **BREAKING** standalone init() stops tying connectionRetryTimeout to startTimeout, and cleanup() runs one order (PR [#883](https://github.com/webdriverio/desktop-mobile/pull/883))
- **native-core**: reject concurrent use of an active managed dev server (PR [#864](https://github.com/webdriverio/desktop-mobile/pull/864))
- **native-cdp-bridge**: reject when debugger port wait times out (PR [#870](https://github.com/webdriverio/desktop-mobile/pull/870))
- **electron,native-cdp-bridge**: report the CDP bridge connection error (PR [#814](https://github.com/webdriverio/desktop-mobile/pull/814))
- CI follow-ups for the dependency update (PR [#829](https://github.com/webdriverio/desktop-mobile/pull/829))
- **tauri,electron**: stop calling executeAsync, which WebdriverIO v10 removed (PR [#794](https://github.com/webdriverio/desktop-mobile/pull/794))
- support WebdriverIO v10's multiremote flag and command options (PR [#792](https://github.com/webdriverio/desktop-mobile/pull/792))
- take \@wdio/logger as a peer so services share the WebdriverIO log file (PR [#724](https://github.com/webdriverio/desktop-mobile/pull/724))
- finish mock and driver teardown after a failure, then report it (PR [#744](https://github.com/webdriverio/desktop-mobile/pull/744) · closes [#683](https://github.com/webdriverio/desktop-mobile/issues/683))

## [@wdio/native-cdp-bridge@2.0.0] - 2026-11-02

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-native-cdp-bridge@v1.3.1...wdio-native-cdp-bridge@v2.0.0)

### Changed
- **BREAKING** require Node.js 22.23.4, 24.22.1 or 26.12.1 on every package (PR [#916](https://github.com/webdriverio/desktop-mobile/pull/916))
- update deps (PR [#803](https://github.com/webdriverio/desktop-mobile/pull/803))
- **BREAKING** require Node.js 22.19 on every package (PR [#797](https://github.com/webdriverio/desktop-mobile/pull/797))

### Fixed
- **native-cdp-bridge**: preserve wait-port rejection messages instead of reporting a port timeout (PR [#881](https://github.com/webdriverio/desktop-mobile/pull/881))
- **native-cdp-bridge**: reject when debugger port wait times out (PR [#870](https://github.com/webdriverio/desktop-mobile/pull/870))
- **electron,native-cdp-bridge**: report the CDP bridge connection error (PR [#814](https://github.com/webdriverio/desktop-mobile/pull/814))
- CI follow-ups for the dependency update (PR [#829](https://github.com/webdriverio/desktop-mobile/pull/829))

## [@wdio/native-core@2.0.0] - 2026-11-02

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-native-core@v1.3.1...wdio-native-core@v2.0.0)

### Changed
- **BREAKING** require Node.js 22.23.4, 24.22.1 or 26.12.1 on every package (PR [#916](https://github.com/webdriverio/desktop-mobile/pull/916))
- share the multiremote wiring helpers (normaliseInstanceCaps, forEachInstance) (PR [#900](https://github.com/webdriverio/desktop-mobile/pull/900))
- **biome**: require braces around if, else and loop bodies (PR [#851](https://github.com/webdriverio/desktop-mobile/pull/851))
- **BREAKING** require Node.js 22.19 on every package (PR [#797](https://github.com/webdriverio/desktop-mobile/pull/797))

### Fixed
- **BREAKING** **dioxus,tauri,electrobun,electron,native-core,native-types**: resolve browser mode per capability (PR [#953](https://github.com/webdriverio/desktop-mobile/pull/953) · closes [#944](https://github.com/webdriverio/desktop-mobile/issues/944))
- typecheck the services against WebdriverIO v9's getInstance() types (PR [#918](https://github.com/webdriverio/desktop-mobile/pull/918) · closes [#903](https://github.com/webdriverio/desktop-mobile/issues/903))
- **native-core**: reject concurrent use of an active managed dev server (PR [#864](https://github.com/webdriverio/desktop-mobile/pull/864))
- take \@wdio/logger as a peer so services share the WebdriverIO log file (PR [#724](https://github.com/webdriverio/desktop-mobile/pull/724))
- finish mock and driver teardown after a failure, then report it (PR [#744](https://github.com/webdriverio/desktop-mobile/pull/744) · closes [#683](https://github.com/webdriverio/desktop-mobile/issues/683))

## [@wdio/native-mobile-core@2.0.0] - 2026-11-02

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-native-mobile-core@v1.2.1...wdio-native-mobile-core@v2.0.0)

### Changed
- **BREAKING** require Node.js 22.23.4, 24.22.1 or 26.12.1 on every package (PR [#916](https://github.com/webdriverio/desktop-mobile/pull/916))
- **BREAKING** take webdriverio and \@wdio/* as optional peers (PR [#798](https://github.com/webdriverio/desktop-mobile/pull/798))
- **BREAKING** require Node.js 22.19 on every package (PR [#797](https://github.com/webdriverio/desktop-mobile/pull/797))

### Fixed
- **BREAKING** standalone init() stops tying connectionRetryTimeout to startTimeout, and cleanup() runs one order (PR [#883](https://github.com/webdriverio/desktop-mobile/pull/883))

## [@wdio/native-spy@2.0.0] - 2026-11-02

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-native-spy@v1.4.1...wdio-native-spy@v2.0.0)

### Added
- **BREAKING** **dioxus**: add mock.withImplementation (PR [#901](https://github.com/webdriverio/desktop-mobile/pull/901))

### Changed
- **BREAKING** require Node.js 22.23.4, 24.22.1 or 26.12.1 on every package (PR [#916](https://github.com/webdriverio/desktop-mobile/pull/916))
- **biome**: require braces around if, else and loop bodies (PR [#851](https://github.com/webdriverio/desktop-mobile/pull/851))
- **BREAKING** require Node.js 22.19 on every package (PR [#797](https://github.com/webdriverio/desktop-mobile/pull/797))

### Fixed
- **BREAKING** await async withImplementation callbacks and correct execute's types and docs (PR [#896](https://github.com/webdriverio/desktop-mobile/pull/896))
- **tauri**: make native-mode emitEvent reach the app's listeners (PR [#858](https://github.com/webdriverio/desktop-mobile/pull/858))
- CI follow-ups for the dependency update (PR [#829](https://github.com/webdriverio/desktop-mobile/pull/829))

## [@wdio/native-types@3.0.0] - 2026-11-02

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-native-types@v2.6.1...wdio-native-types@v3.0.0)

### Added
- **BREAKING** **dioxus**: add mock.withImplementation (PR [#901](https://github.com/webdriverio/desktop-mobile/pull/901))

### Changed
- **BREAKING** require Node.js 22.23.4, 24.22.1 or 26.12.1 on every package (PR [#916](https://github.com/webdriverio/desktop-mobile/pull/916))
- **native-types**: document Tauri's mock.withImplementation (PR [#914](https://github.com/webdriverio/desktop-mobile/pull/914))
- **BREAKING** **native-types,tauri**: remove the unused commandTimeout option (PR [#832](https://github.com/webdriverio/desktop-mobile/pull/832))
- update deps (PR [#803](https://github.com/webdriverio/desktop-mobile/pull/803))
- **BREAKING** **tauri,native-types**: remove driverProvider 'official' and the unused command helpers (PR [#802](https://github.com/webdriverio/desktop-mobile/pull/802))
- **BREAKING** **native-types,electron**: remove the deprecated mock overloads (PR [#801](https://github.com/webdriverio/desktop-mobile/pull/801))
- **BREAKING** take webdriverio and \@wdio/* as optional peers (PR [#798](https://github.com/webdriverio/desktop-mobile/pull/798))
- **BREAKING** require Node.js 22.19 on every package (PR [#797](https://github.com/webdriverio/desktop-mobile/pull/797))

### Fixed
- **BREAKING** **dioxus,tauri,electrobun,electron,native-core,native-types**: resolve browser mode per capability (PR [#953](https://github.com/webdriverio/desktop-mobile/pull/953) · closes [#944](https://github.com/webdriverio/desktop-mobile/issues/944))
- **BREAKING** **tauri,native-types**: type tauri:options.webviewOptions as msedgedriver's WebView2 options (PR [#958](https://github.com/webdriverio/desktop-mobile/pull/958))
- **BREAKING** **native-types,tauri**: accept rootDir only on the Electron service (PR [#947](https://github.com/webdriverio/desktop-mobile/pull/947) · closes [#945](https://github.com/webdriverio/desktop-mobile/issues/945))
- **BREAKING** **dioxus,native-types**: pass 'dioxus:options'.args to the app and drop webviewOptions (PR [#946](https://github.com/webdriverio/desktop-mobile/pull/946) · closes [#938](https://github.com/webdriverio/desktop-mobile/issues/938))
- **BREAKING** await async withImplementation callbacks and correct execute's types and docs (PR [#896](https://github.com/webdriverio/desktop-mobile/pull/896))
- **BREAKING** standalone init() stops tying connectionRetryTimeout to startTimeout, and cleanup() runs one order (PR [#883](https://github.com/webdriverio/desktop-mobile/pull/883))
- **BREAKING** **native-types**: narrow TauriAPIs to the core.invoke that execute passes (PR [#860](https://github.com/webdriverio/desktop-mobile/pull/860) · closes [#859](https://github.com/webdriverio/desktop-mobile/issues/859))
- **tauri**: make native-mode emitEvent reach the app's listeners (PR [#858](https://github.com/webdriverio/desktop-mobile/pull/858))
- **native-cdp-bridge**: reject when debugger port wait times out (PR [#870](https://github.com/webdriverio/desktop-mobile/pull/870))
- **tauri,dioxus**: honour global startTimeout and log options in standalone init() (PR [#816](https://github.com/webdriverio/desktop-mobile/pull/816))
- CI follow-ups for the dependency update (PR [#829](https://github.com/webdriverio/desktop-mobile/pull/829))
- **tauri,electron**: stop calling executeAsync, which WebdriverIO v10 removed (PR [#794](https://github.com/webdriverio/desktop-mobile/pull/794))
- support WebdriverIO v10's multiremote flag and command options (PR [#792](https://github.com/webdriverio/desktop-mobile/pull/792))

## [@wdio/native-utils@3.0.0] - 2026-11-02

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-native-utils@v2.8.1...wdio-native-utils@v3.0.0)

### Added
- **native-utils**: add shared severeServiceError(message, cause) helper (PR [#835](https://github.com/webdriverio/desktop-mobile/pull/835))

### Changed
- share runThenSync between the Tauri, Dioxus and Electron mocks (PR [#917](https://github.com/webdriverio/desktop-mobile/pull/917))
- **BREAKING** require Node.js 22.23.4, 24.22.1 or 26.12.1 on every package (PR [#916](https://github.com/webdriverio/desktop-mobile/pull/916))
- **native-utils**: move the error helpers out of the teardown module (PR [#856](https://github.com/webdriverio/desktop-mobile/pull/856))
- **biome**: require braces around if, else and loop bodies (PR [#851](https://github.com/webdriverio/desktop-mobile/pull/851))
- **BREAKING** take webdriverio and \@wdio/* as optional peers (PR [#798](https://github.com/webdriverio/desktop-mobile/pull/798))
- **BREAKING** require Node.js 22.19 on every package (PR [#797](https://github.com/webdriverio/desktop-mobile/pull/797))

### Fixed
- **BREAKING** await async withImplementation callbacks and correct execute's types and docs (PR [#896](https://github.com/webdriverio/desktop-mobile/pull/896))
- **BREAKING** standalone init() stops tying connectionRetryTimeout to startTimeout, and cleanup() runs one order (PR [#883](https://github.com/webdriverio/desktop-mobile/pull/883))
- **tauri,native-utils**: report a Wayland display in the launcher logs and say which variable is set (PR [#890](https://github.com/webdriverio/desktop-mobile/pull/890))
- **native-utils**: count a Wayland display in the display diagnostic (PR [#878](https://github.com/webdriverio/desktop-mobile/pull/878))
- CI follow-ups for the dependency update (PR [#829](https://github.com/webdriverio/desktop-mobile/pull/829))
- support WebdriverIO v10's multiremote flag and command options (PR [#792](https://github.com/webdriverio/desktop-mobile/pull/792))
- take \@wdio/logger as a peer so services share the WebdriverIO log file (PR [#724](https://github.com/webdriverio/desktop-mobile/pull/724))
- finish mock and driver teardown after a failure, then report it (PR [#744](https://github.com/webdriverio/desktop-mobile/pull/744) · closes [#683](https://github.com/webdriverio/desktop-mobile/issues/683))

## [@wdio/react-native-service@1.0.0-next.4] - 2026-11-02

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-react-native-service@v1.0.0-next.3...wdio-react-native-service@v1.0.0-next.4)

### Added
- **native-utils**: add shared severeServiceError(message, cause) helper (PR [#835](https://github.com/webdriverio/desktop-mobile/pull/835))

### Changed
- **BREAKING** require Node.js 22.23.4, 24.22.1 or 26.12.1 on every package (PR [#916](https://github.com/webdriverio/desktop-mobile/pull/916))
- **biome**: require braces around if, else and loop bodies (PR [#851](https://github.com/webdriverio/desktop-mobile/pull/851))
- **BREAKING** take webdriverio and \@wdio/* as optional peers (PR [#798](https://github.com/webdriverio/desktop-mobile/pull/798))
- **BREAKING** require Node.js 22.19 on every package (PR [#797](https://github.com/webdriverio/desktop-mobile/pull/797))

### Fixed
- CI follow-ups for the dependency update (PR [#829](https://github.com/webdriverio/desktop-mobile/pull/829))
- support WebdriverIO v10's multiremote flag and command options (PR [#792](https://github.com/webdriverio/desktop-mobile/pull/792))
- finish mock and driver teardown after a failure, then report it (PR [#744](https://github.com/webdriverio/desktop-mobile/pull/744) · closes [#683](https://github.com/webdriverio/desktop-mobile/issues/683))

## [@wdio/dioxus-bridge@1.1.0] - 2026-10-24

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-dioxus-bridge@v1.0.0...wdio-dioxus-bridge@v1.1.0)

### Added

- **dioxus**: add single app crate `wdio-dioxus` (PR [#717](https://github.com/webdriverio/desktop-mobile/pull/717))

### Changed

- **dioxus**: set apps up with wdio-dioxus, and point the service's errors at it (PR [#777](https://github.com/webdriverio/desktop-mobile/pull/777))
- **deps**: bump the cargo-dependencies group across 7 directories with 8 updates (PR [#770](https://github.com/webdriverio/desktop-mobile/pull/770))
- **deps**: update dependencies and keep the Tauri sync script on stable releases (PR [#759](https://github.com/webdriverio/desktop-mobile/pull/759))
- enforce coverage thresholds in every package's unit run (PR [#728](https://github.com/webdriverio/desktop-mobile/pull/728))
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

## [@wdio/dioxus-service@1.1.0] - 2026-10-24

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-dioxus-service@v1.0.0...wdio-dioxus-service@v1.1.0)

### Changed

- **dioxus**: set apps up with wdio-dioxus, and point the service's errors at it (PR [#777](https://github.com/webdriverio/desktop-mobile/pull/777))
- **deps**: update dependencies and keep the Tauri sync script on stable releases (PR [#759](https://github.com/webdriverio/desktop-mobile/pull/759))
- enforce coverage thresholds in every package's unit run (PR [#728](https://github.com/webdriverio/desktop-mobile/pull/728))
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

- **dioxus**: pass the service-level windowLabel to the embedded driver (PR [#773](https://github.com/webdriverio/desktop-mobile/pull/773))
- **tauri,dioxus**: open standalone browser-mode sessions without a driver port (PR [#745](https://github.com/webdriverio/desktop-mobile/pull/745) · closes [#696](https://github.com/webdriverio/desktop-mobile/issues/696))
- **dioxus**: start the embedded driver only under the service, and say why startup failed (PR [#710](https://github.com/webdriverio/desktop-mobile/pull/710))
- **dioxus**: make the setup docs and errors match what v1 supports (embedded driver only) (PR [#703](https://github.com/webdriverio/desktop-mobile/pull/703))
- **tauri,electron,dioxus**: stop restoring mocks after the session is deleted (PR [#686](https://github.com/webdriverio/desktop-mobile/pull/686) · closes [#685](https://github.com/webdriverio/desktop-mobile/issues/685))
- **dioxus**: reap already-spawned embedded drivers on a later instance's pre-spawn failure (PR [#670](https://github.com/webdriverio/desktop-mobile/pull/670) · closes [#669](https://github.com/webdriverio/desktop-mobile/issues/669))

## [wdio-dioxus-driver@1.1.0] - 2026-10-24

### Added

- **dioxus**: add single app crate `wdio-dioxus` (\#717)

### Changed

- **deps**: bump the cargo-dependencies group across 7 directories with 8 updates (\#770)
- **deps**: bump the cargo-dependencies group across 6 directories with 2 updates (\#715)
- **release**: revert the unpublished \#642 release and fix standing-PR selection (\#707)
- release 17 package(s) (\#642)
- **deps**: bump the cargo-dependencies group across 5 directories with 5 updates (\#700)
- **deps**: bump the cargo-dependencies group across 5 directories with 10 updates (\#616)

### Fixed

- **dioxus**: make the setup docs and errors match what v1 supports (embedded driver only) (\#703)

## [wdio-dioxus-embedded-driver@1.1.0] - 2026-10-24

### Changed

- **dioxus**: set apps up with wdio-dioxus, and point the service's errors at it (\#777)
- **deps**: bump the cargo-dependencies group across 7 directories with 8 updates (\#770)
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

## wdio-dioxus@1.1.0 - 2026-10-24

_First release of wdio-dioxus._

### Added

- **dioxus**: add single app crate `wdio-dioxus` (\#717)

## [@wdio/tauri-plugin@1.5.1] - 2026-10-24

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-tauri-plugin@v1.5.0...wdio-tauri-plugin@v1.5.1)

### Changed

- **deps**: bump the cargo-dependencies group across 7 directories with 8 updates (PR [#770](https://github.com/webdriverio/desktop-mobile/pull/770))
- **deps**: update dependencies and keep the Tauri sync script on stable releases (PR [#759](https://github.com/webdriverio/desktop-mobile/pull/759))
- **tauri**: make the embedded WebDriver plugin desktop-only (PR [#758](https://github.com/webdriverio/desktop-mobile/pull/758))
- **tauri**: sync the crates' own versions in the committed Cargo.lock files (PR [#748](https://github.com/webdriverio/desktop-mobile/pull/748))

### Fixed

- **tauri**: ship generated permission files in the plugin crates (PR [#743](https://github.com/webdriverio/desktop-mobile/pull/743) · closes [#730](https://github.com/webdriverio/desktop-mobile/issues/730))

## [@wdio/tauri-service@1.5.1] - 2026-10-24

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-tauri-service@v1.5.0...wdio-tauri-service@v1.5.1)

### Changed

- **deps**: update dependencies and keep the Tauri sync script on stable releases (PR [#759](https://github.com/webdriverio/desktop-mobile/pull/759))
- enforce coverage thresholds in every package's unit run (PR [#728](https://github.com/webdriverio/desktop-mobile/pull/728))
- **biome**: flag barrel files outside package entry points (PR [#729](https://github.com/webdriverio/desktop-mobile/pull/729))

### Fixed

- **tauri,electrobun**: name the right WebKitWebDriver package for each Linux distro (PR [#771](https://github.com/webdriverio/desktop-mobile/pull/771))
- **tauri,dioxus**: open standalone browser-mode sessions without a driver port (PR [#745](https://github.com/webdriverio/desktop-mobile/pull/745) · closes [#696](https://github.com/webdriverio/desktop-mobile/issues/696))

## [tauri-plugin-wdio-webdriver@1.5.1] - 2026-10-24

### Changed

- **deps**: bump the cargo-dependencies group across 7 directories with 8 updates (\#770)
- **tauri**: make the embedded WebDriver plugin desktop-only (\#758)
- **tauri**: sync the crates' own versions in the committed Cargo.lock files (\#748)

### Fixed

- **tauri**: let Close Window request a close the app can prevent (\#772, \#737)
- **tauri,electrobun**: name the right WebKitWebDriver package for each Linux distro (\#771)
- **tauri**: dispatch PointerEvents for embedded pointer actions (\#746, \#736)
- **tauri**: ship generated permission files in the plugin crates (\#743, \#730)
- **tauri**: map every WebDriver special key and stop typing them as text (\#747, \#735)

## [@wdio/flutter-service@1.0.0-next.4] - 2026-10-24

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-flutter-service@v1.0.0-next.3...wdio-flutter-service@v1.0.0-next.4)

### Changed

- **deps**: update dependencies and keep the Tauri sync script on stable releases (PR [#759](https://github.com/webdriverio/desktop-mobile/pull/759))
- enforce coverage thresholds in every package's unit run (PR [#728](https://github.com/webdriverio/desktop-mobile/pull/728))

## [@wdio/electrobun-service@0.3.1] - 2026-10-24

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-electrobun-service@v0.3.0...wdio-electrobun-service@v0.3.1)

### Changed

- **deps**: update dependencies and keep the Tauri sync script on stable releases (PR [#759](https://github.com/webdriverio/desktop-mobile/pull/759))
- enforce coverage thresholds in every package's unit run (PR [#728](https://github.com/webdriverio/desktop-mobile/pull/728))

### Fixed

- **tauri,electrobun**: name the right WebKitWebDriver package for each Linux distro (PR [#771](https://github.com/webdriverio/desktop-mobile/pull/771))

## [@wdio/electron-service@10.4.1] - 2026-10-24

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-electron-service@v10.4.0...wdio-electron-service@v10.4.1)

### Changed

- **deps**: update dependencies and keep the Tauri sync script on stable releases (PR [#759](https://github.com/webdriverio/desktop-mobile/pull/759))
- enforce coverage thresholds in every package's unit run (PR [#728](https://github.com/webdriverio/desktop-mobile/pull/728))
- **biome**: flag barrel files outside package entry points (PR [#729](https://github.com/webdriverio/desktop-mobile/pull/729))

## [@wdio/native-cdp-bridge@1.3.1] - 2026-10-24

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-native-cdp-bridge@v1.3.0...wdio-native-cdp-bridge@v1.3.1)

### Changed

- **deps**: update dependencies and keep the Tauri sync script on stable releases (PR [#759](https://github.com/webdriverio/desktop-mobile/pull/759))
- enforce coverage thresholds in every package's unit run (PR [#728](https://github.com/webdriverio/desktop-mobile/pull/728))

## [@wdio/native-core@1.3.1] - 2026-10-24

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-native-core@v1.3.0...wdio-native-core@v1.3.1)

### Changed

- **deps**: update dependencies and keep the Tauri sync script on stable releases (PR [#759](https://github.com/webdriverio/desktop-mobile/pull/759))
- **biome**: flag console in package source (PR [#726](https://github.com/webdriverio/desktop-mobile/pull/726))
- enforce coverage thresholds in every package's unit run (PR [#728](https://github.com/webdriverio/desktop-mobile/pull/728))
- **biome**: flag barrel files outside package entry points (PR [#729](https://github.com/webdriverio/desktop-mobile/pull/729))

## [@wdio/native-mobile-core@1.2.1] - 2026-10-24

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-native-mobile-core@v1.2.0...wdio-native-mobile-core@v1.2.1)

### Changed

- **deps**: update dependencies and keep the Tauri sync script on stable releases (PR [#759](https://github.com/webdriverio/desktop-mobile/pull/759))
- enforce coverage thresholds in every package's unit run (PR [#728](https://github.com/webdriverio/desktop-mobile/pull/728))

## [@wdio/native-spy@1.4.1] - 2026-10-24

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-native-spy@v1.4.0...wdio-native-spy@v1.4.1)

### Changed

- **deps**: update dependencies and keep the Tauri sync script on stable releases (PR [#759](https://github.com/webdriverio/desktop-mobile/pull/759))
- enforce coverage thresholds in every package's unit run (PR [#728](https://github.com/webdriverio/desktop-mobile/pull/728))

## [@wdio/native-types@2.6.1] - 2026-10-24

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-native-types@v2.6.0...wdio-native-types@v2.6.1)

### Changed

- **deps**: update dependencies and keep the Tauri sync script on stable releases (PR [#759](https://github.com/webdriverio/desktop-mobile/pull/759))

### Fixed

- **dioxus**: pass the service-level windowLabel to the embedded driver (PR [#773](https://github.com/webdriverio/desktop-mobile/pull/773))
- **dioxus**: make the setup docs and errors match what v1 supports (embedded driver only) (PR [#703](https://github.com/webdriverio/desktop-mobile/pull/703))

## [@wdio/native-utils@2.8.1] - 2026-10-24

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-native-utils@v2.8.0...wdio-native-utils@v2.8.1)

### Changed

- **deps**: update dependencies and keep the Tauri sync script on stable releases (PR [#759](https://github.com/webdriverio/desktop-mobile/pull/759))
- **biome**: flag console in package source (PR [#726](https://github.com/webdriverio/desktop-mobile/pull/726))
- enforce coverage thresholds in every package's unit run (PR [#728](https://github.com/webdriverio/desktop-mobile/pull/728))

### Fixed

- **tauri,electrobun**: name the right WebKitWebDriver package for each Linux distro (PR [#771](https://github.com/webdriverio/desktop-mobile/pull/771))

## [@wdio/react-native-service@1.0.0-next.3] - 2026-10-24

[Full Changelog](https://github.com/webdriverio/desktop-mobile/compare/wdio-react-native-service@v1.0.0-next.2...wdio-react-native-service@v1.0.0-next.3)

### Changed

- **deps**: update dependencies and keep the Tauri sync script on stable releases (PR [#759](https://github.com/webdriverio/desktop-mobile/pull/759))
- enforce coverage thresholds in every package's unit run (PR [#728](https://github.com/webdriverio/desktop-mobile/pull/728))
- **biome**: flag barrel files outside package entry points (PR [#729](https://github.com/webdriverio/desktop-mobile/pull/729))

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
