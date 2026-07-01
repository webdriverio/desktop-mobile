# Roadmap

This document outlines the released services and the development sequencing for planned ones in the WebdriverIO Desktop & Mobile Testing project.

## Released Services

Published packages, grouped by release maturity. Status reflects the npm dist-tag, not just "exists on npm".

### ✅ Stable (`latest`)

#### [@wdio/electron-service](./packages/electron-service) — v10.x
**Platforms:** Windows, macOS, Linux\
[![npm downloads](https://img.shields.io/npm/dm/@wdio/electron-service)](https://npmjs.com/package/@wdio/electron-service)

#### [@wdio/tauri-service](./packages/tauri-service) — v1.x
**Platforms:** Windows, macOS, Linux\
[![npm downloads](https://img.shields.io/npm/dm/@wdio/tauri-service)](https://npmjs.com/package/@wdio/tauri-service)

### 🚧 Pre-release (`next`, `1.0.0-next.x`)

> Feature-complete services published on the `next` dist-tag while the API and CI stabilise toward `1.0`.

#### [@wdio/dioxus-service](./packages/dioxus-service) — v1.0.0-next
**Platforms:** Windows, macOS, Linux (`'embedded'` provider); Windows only for `'external'`\
**Highlights:** Wry webview → CDP (shared patterns with the Tauri service); `execute`, mocking, log forwarding, browser mode, multiremote, standalone session.\
[![npm downloads](https://img.shields.io/npm/dm/@wdio/dioxus-service)](https://npmjs.com/package/@wdio/dioxus-service)

#### [@wdio/react-native-service](./packages/react-native-service) — v1.0.0-next
**Platforms:** Android, iOS\
**Highlights:** native find/tap via Appium (UiAutomator2 / XCUITest); `execute` + `mock` via Hermes CDP (debug/Metro build); deeplink, context switching, log capture, multiremote/DeviceManager. Established the shared `@wdio/native-mobile-core` mobile scaffold.\
[![npm downloads](https://img.shields.io/npm/dm/@wdio/react-native-service)](https://npmjs.com/package/@wdio/react-native-service)

#### [@wdio/flutter-service](./packages/flutter-service) — v1.0.0-next
**Platforms:** Android, iOS\
**Highlights:** native find/tap via appium-flutter-driver (`FLUTTER` context); `execute` (a Dart expression) + `mock` (the cooperative [`wdio_flutter`](./packages/flutter-bridge) Dart contract) via the Dart VM Service (debug/profile build); deeplink, context switching, log capture, multiremote/DeviceManager. Built on `@wdio/native-mobile-core`.\
[![npm downloads](https://img.shields.io/npm/dm/@wdio/flutter-service)](https://npmjs.com/package/@wdio/flutter-service)

### 🧪 Experimental (`0.x`)

> Feature surface limited by upstream gaps; not yet at parity with the services above.

#### [@wdio/electrobun-service](./packages/electrobun-service) — v0.1.x
**Platforms:** macOS 14+ (CEF), Windows 11+ (WebView2); Linux blocked upstream\
**Highlights:** drives two renderers — **macOS via CEF** (CDP) and **Windows via the native WebView2** (Chromium over CDP, no CEF) — the latter also running the multi-window suite that CEF can't on CI.\
**Caveats:** **Linux** blocked upstream (CEF serves no `/json`; the WebKitGTK renderer needs upstream W3C-WebDriver automation — [electrobun#467](https://github.com/blackboardsh/electrobun/issues/467)); **deeplink on Windows** and **deeplink/multiremote on the macOS CEF path** are upstream-blocked. Each upstream fix re-enables a platform/feature, graduating toward `1.0` at full parity. Tracked in [#317](https://github.com/webdriverio/desktop-mobile/issues/317) (non-CEF) + [#320](https://github.com/webdriverio/desktop-mobile/issues/320) (CEF). See the [package README](./packages/electrobun-service).\
[![npm downloads](https://img.shields.io/npm/dm/@wdio/electrobun-service)](https://npmjs.com/package/@wdio/electrobun-service)

---

## Cross-cutting Capabilities

The roadmap above is scoped to *new framework support*. Capability-level features that apply to existing services are tracked here.

| Capability | Status | Notes |
|---|---|---|
| **Visual regression testing** | ✅ Available via [`@wdio/visual-service`](https://webdriver.io/docs/visual-testing/) | See [docs/visual-testing.md](./docs/visual-testing.md) for the wiring + provider notes. |
| **Video recording** | 🔍 Not yet planned | Treated as a separate track. Universally a debugging artefact rather than a regression signal in the test-frameworks we surveyed. |

---

## Shared Mobile Infrastructure

The mobile services (React Native, Flutter, and future Capacitor) share a common Appium layer in `@wdio/native-mobile-core`. Two tracks harden and generalise it.

| Track | Status | Notes |
|---|---|---|
| **Zero-config mobile setup** | 📋 Planned | Chromedriver-style auto-management: opt-in Appium driver install + version matrix, per-worker realm-port allocation, cap-default derivation, and a fail-fast preflight doctor. Shared [#378](https://github.com/webdriverio/desktop-mobile/issues/378) + Flutter [#405](https://github.com/webdriverio/desktop-mobile/issues/405) + React Native [#406](https://github.com/webdriverio/desktop-mobile/issues/406). |
| **Generic `@wdio/mobile-service`** | 📋 Planned | A publishable mobile service for any Appium-drivable app (plain native, NativeScript, MAUI, Capacitor shells): native find/tap, deeplink, context switching, logs, multiremote — without a framework realm. React Native and Flutter converge onto it as thin extensions that add only their JS/Dart `execute`/`mock`. Design: [spec](./agent-os/specs/20260618-mobile-service-convergence/spec.md). |

Composition stays two-entry — `services: ['appium', '<framework>']`; the shared layer is inherited, not listed separately. See the [design spec](./agent-os/specs/20260618-mobile-service-convergence/spec.md) for the full model.

**Sequencing:** the zero-config setup-automation track is in flight now (pre-release hardening of the mobile services). The generic `@wdio/mobile-service` + the React Native / Flutter convergence onto it is targeted **Q4 2026, ahead of Capacitor** — Capacitor is its first consumer and extends it rather than re-implementing the mobile scaffold.

---

## Framework Compatibility Analysis

The table below quantifies the key factors used to prioritise and sequence planned services. GitHub stars serve as a proxy for ecosystem size and developer interest; automation driver maturity indicates how production-ready the underlying test infrastructure is; and pattern reuse scores how much existing service code can be directly leveraged. Stars are approximate as of early 2026.

| Framework | Type | GitHub Stars | Automation Driver | Driver Maturity | Pattern Reuse vs Existing Services | Key Dependencies | Relative Integration Complexity |
|---|---|---|---|---|---|---|---|
| **Electron** *(released)* | Desktop | ~120k | Chrome DevTools Protocol (CDP) | ✅ Proven | — | Chromium, Node.js | — |
| **Tauri** *(released)* | Desktop | ~100k | tauri-driver + CDP | ✅ Proven | — | Wry, Rust toolchain | — |
| **Dioxus** *(released)* | Desktop | ~34k | Wry webview → CDP (shared with Tauri) | ✅ Implemented | High — same Wry/CDP patterns as Tauri service | Wry maturity, Dioxus desktop stability | Low–Medium |
| **React Native** *(released)* | Mobile | ~121k | Appium (XCUITest / UiAutomator2) | ✅ Proven | Establishes mobile scaffold | Appium server stability, XCUITest / UiAutomator2 | Medium |
| **Flutter** *(released)* | Mobile | ~175k | Appium Flutter Driver | ✅ Production-ready | Reuses React Native mobile scaffold | Appium Flutter Driver maintenance, Dart VM | Medium |
| **Electrobun** *(released)* | Desktop | ~11.7k | Native CDP (port 9222 by convention) | 🟡 Emerging | Medium — CDP attach patterns from Electron service; no driver process | Bun runtime, system webviews, OOPIF (per-tab) target routing | Medium |
| **Ionic / Capacitor** | Mobile | ~52k / ~15k | Appium WebView context switching | ✅ Proven | Reuses mobile scaffold; pure WebView — zero new complexity | Appium server, native WebView availability | Low |
| **Neutralino** | Desktop | ~7.9k | System webview → CDP (devtools endpoint) | 🟡 Emerging | Medium — similar endpoint detection to Electron service | System webview (WebView2 / WebKitGTK) | Low |
| **Dioxus Mobile** | Mobile | *(same repo)* | Cargo Mobile 2 — experimental | 🔴 Early-stage | Reuses mobile scaffold + Dioxus desktop learnings | Cargo Mobile 2 maturity, platform bridge stability | High |
| **React Native Desktop** | Desktop | *(same repo)* | Less mature than mobile counterpart | 🟡 Emerging | Leverages React Native mobile experience | React Native Desktop renderer maturity | Medium–High |

---

## Planned Services

Forward sequence, ordered by target window. Targets are aspirational (see the disclaimer at the end).

### Generic Mobile Service — targeted Q4 2026
**Priority:** High — unlocks Capacitor and any native / other-framework app

Promote the shared `@wdio/native-mobile-core` layer into a concrete, publishable `@wdio/mobile-service` for any Appium-drivable app (plain native, NativeScript, MAUI, Capacitor shells), and converge React Native + Flutter onto it as thin extensions that add only their JS/Dart realm. See [Shared Mobile Infrastructure](#shared-mobile-infrastructure) and the [design spec](./agent-os/specs/20260618-mobile-service-convergence/spec.md).

### Capacitor Mobile — Q1 2027
**Priority:** Medium — Ionic ecosystem coverage\
**Prerequisite:** extends the generic [`@wdio/mobile-service`](#shared-mobile-infrastructure) base — Capacitor is its first consumer, not a re-implementation of the mobile scaffold.

**Target Platforms:** iOS, Android

**Why Capacitor:**
- Ionic's 1M+ app ecosystem
- Pure WebView pattern (zero new complexity)
- Replaces deprecated Cordova/PhoneGap

**Technical approach:**
- Standard Appium WebView context switching
- appPackage/appActivity capabilities

### Neutralino Desktop — Q3 2027
**Priority:** Low — Niche use case

**Target Platforms:** Windows, macOS, Linux

**Why Neutralino:**
- Extremely lightweight alternative to Electron
- JavaScript ecosystem alignment
- Web-based architecture

**Technical approach:**
- System webview automation via ChromeDriver CDP
- `neutralinojs --enable-inspector` launch integration
- Electron service patterns (devtools endpoint detection)
- Standard WebdriverIO parallelization

### Dioxus Mobile (Experimental) — Q4 2027
**Priority:** Low — Experimental platform

**Target Platforms:** iOS, Android (experimental)

**Why experimental:**
- Dioxus mobile is early-stage
- Reuses established mobile scaffold
- Completes Rust ecosystem coverage

### React Native Desktop — Q1 2028
**Priority:** Low — Desktop expansion

**Target Platforms:** Windows, macOS, Linux

**Why later:**
- Less mature than React Native mobile
- Lower demand vs mobile priorities
- Leverages the React Native mobile experience

## Not Planned

The following frameworks were evaluated and excluded from the roadmap:

| Framework | Reason |
|---|---|
| NW.js | Declining popularity, overlaps with Electron |
| Cordova / PhoneGap | Deprecated (2020), replaced by Capacitor |
| Qt / QML | Native rendering — no WebDriver fit |
| .NET MAUI | No *dedicated* service planned (native UI needs no framework-specific channel) — but native MAUI apps are drivable via the generic [`@wdio/mobile-service`](#shared-mobile-infrastructure) over Appium (UiAutomator2 / XCUITest); MAUI is also the **generic service's E2E fixture** (it dogfoods this exact use case — spike [#508](https://github.com/webdriverio/desktop-mobile/issues/508) confirmed Appium drivability + a cheap ~1.7 min Android CI toolchain) |
| Blazor | Standard web needs no service; Hybrid WebView context switching is unreliable **only on Windows/WinAppDriver** — on Android/iOS `BlazorWebView`/`HybridWebView` are standard `android.webkit.WebView` / `WKWebView` and *are* drivable with a Chromedriver-matched config (spike [#508](https://github.com/webdriverio/desktop-mobile/issues/508)) |
| Wails | Go webview, no established automation patterns |

## Evaluation Criteria

When prioritizing services, we consider:

1. **Market demand** - User requests and ecosystem size
2. **Technical feasibility** - Availability of drivers and tooling
3. **Maintenance burden** - Ongoing support requirements
4. **Ecosystem maturity** - Framework stability and community
5. **Platform coverage** - Mobile vs desktop gaps
6. **Integration complexity** - Development effort required

## Contributing to Roadmap

We welcome community input on the roadmap! To suggest changes:

1. Open a [GitHub Discussion](https://github.com/webdriverio/desktop-mobile/discussions)
2. Provide use case and demand evidence
3. Suggest technical approach if known
4. Indicate willingness to contribute

Roadmap priorities may shift based on:
- Community contributions
- Framework ecosystem changes
- Technical breakthroughs
- Market demand shifts

## Timeline Disclaimer

Timelines are estimates and subject to change based on:
- Maintainer availability
- Community contributions
- Technical challenges
- Framework ecosystem changes

All dates should be considered aspirational goals rather than commitments.
