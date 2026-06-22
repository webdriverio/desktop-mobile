# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).





## @wdio/react-native-service@1.0.0-next.0 - 2026-06-22

_First release of @wdio/react-native-service._

### New
- **Metro/Hermes lifecycle management**: Added automatic Metro lifecycle management with zero-config Hermes support.
- **Mobile setup automation**: Added shared mobile setup automation providing chromedriver-style zero-config developer experience.
- **Flutter service**: Added `@wdio/flutter-service` for Flutter mobile testing support.
- **React Native service**: Added `@wdio/react-native-service` for React Native mobile testing support. (#361)

### Fixed
- Fixed launcher options not being honored when specified at the capability level.
- Fixed mock spies not re-attaching after React Native fast-refresh displaces the target.

### Changed
- Bootstrap react-native and flutter services to 0.0.1 for first prerelease.

## @wdio/native-mobile-core@1.0.0 - 2026-06-22

_First release of @wdio/native-mobile-core._

### New
- **Mobile setup automation**: Added shared mobile setup automation for a chromedriver-style zero-config developer experience
- **@wdio/flutter-service**: Added @wdio/flutter-service for Flutter mobile testing support

### Fixed
- Launcher options specified at the capability level are now properly honored

### Changed
- Staged native-cdp-bridge and native-mobile-core packages at version 1.0.0-next.0
- **Performance**: iOS toolchain probes now run asynchronously without blocking the event loop

## @wdio/native-cdp-bridge@1.0.0 - 2026-06-22

_First release of @wdio/native-cdp-bridge._

### New
- **@wdio/react-native-service**: Added @wdio/react-native-service for testing React Native mobile applications (#361)

### Fixed
- **WebSocket self-healing**: Fixed WebSocket disconnection handling to emit disconnect events and self-heal connections
- Pinned msedgedriver to the WebView2 runtime version to fix Windows test flakiness

### Changed
- Staged native-cdp-bridge and native-mobile-core packages to version 1.0.0-next.0
- **Tooling**: Switched to running repo scripts on bare node instead of tsx (#345)
- **Code Quality**: Extracted shared @wdio/native-cdp-bridge package and reworked electrobun to use it (#333)

## [@wdio/dioxus-bridge@1.0.0-next.3] - 2026-06-18

[Full Changelog](https://github.com/webdriverio/desktop-mobile.git/compare/wdio-dioxus-bridge@v1.0.0-next.2...wdio-dioxus-bridge@v1.0.0-next.3)

### Developer
- **Build System**: Updated project version to 1.0.0-next.3

## [@wdio/dioxus-service@1.0.0-next.3] - 2026-06-18

[Full Changelog](https://github.com/webdriverio/desktop-mobile.git/compare/wdio-dioxus-service@v1.0.0-next.2...wdio-dioxus-service@v1.0.0-next.3)

### Fixed
- Fixed preservation of undefined values in execute() calls. (#409)

## [wdio-dioxus-driver@1.0.0-next.3] - 2026-06-18

### Changed
- Updated version to 1.0.0-next.3

## [wdio-dioxus-embedded-driver@1.0.0-next.3] - 2026-06-18

### Fixed
- Fixed `getTitle` to read `document.title` instead of the OS window title.
