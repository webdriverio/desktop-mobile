# Roadmap

This document outlines the planned services and their development sequencing for the WebdriverIO Desktop & Mobile Testing project.

## Current Services (Available)

### [@wdio/electron-service](./packages/electron-service) - v10.x
**Status:** 🚧 Pre-release (migrated from legacy repo)\
**Platforms:** Windows, macOS, Linux\
[![npm downloads](https://img.shields.io/npm/dm/@wdio/electron-service)](https://npmjs.com/package/@wdio/electron-service)

### [@wdio/tauri-service](./packages/tauri-service) - v1.x
**Status:** 🚧 Pre-release\
**Platforms:** Windows, macOS, Linux\
[![npm downloads](https://img.shields.io/npm/dm/@wdio/tauri-service)](https://npmjs.com/package/@wdio/tauri-service)

---

## Framework Compatibility Analysis

The table below quantifies the key factors used to prioritise and sequence planned services. GitHub stars serve as a proxy for ecosystem size and developer interest; automation driver maturity indicates how production-ready the underlying test infrastructure is; and pattern reuse scores how much existing service code can be directly leveraged. Stars are approximate as of early 2026.

| Framework | Type | GitHub Stars | Automation Driver | Driver Maturity | Pattern Reuse vs Existing Services | Key Dependencies | Relative Integration Complexity |
|---|---|---|---|---|---|---|---|
| **Electron** *(existing)* | Desktop | ~120k | Chrome DevTools Protocol (CDP) | ✅ Proven | — | Chromium, Node.js | — |
| **Tauri** *(existing)* | Desktop | ~100k | tauri-driver + CDP | ✅ Proven | — | Wry, Rust toolchain | — |
| **React Native** | Mobile | ~121k | Appium (XCUITest / UiAutomator2) | ✅ Proven | Establishes mobile scaffold | Appium server stability, XCUITest / UiAutomator2 | Medium |
| **Flutter** | Mobile | ~175k | Appium Flutter Driver | ✅ Production-ready | Reuses React Native mobile scaffold | Appium Flutter Driver maintenance, Dart VM | Medium |
| **Ionic / Capacitor** | Mobile | ~52k / ~15k | Appium WebView context switching | ✅ Proven | Reuses mobile scaffold; pure WebView — zero new complexity | Appium server, native WebView availability | Low |
| **Dioxus** | Desktop | ~34k | Wry webview → CDP (shared with Tauri) | 🟡 Emerging | High — same Wry/CDP patterns as Tauri service | Wry maturity, Dioxus desktop stability | Low–Medium |
| **Electrobun** | Desktop | ~11.7k | Native CDP (port 9222 by convention) | 🟡 Emerging | Medium — CDP attach patterns from Electron service; no driver process | Bun runtime, system webviews, OOPIF (per-tab) target routing | Medium |
| **Neutralino** | Desktop | ~7.9k | System webview → CDP (devtools endpoint) | 🟡 Emerging | Medium — similar endpoint detection to Electron service | System webview (WebView2 / WebKitGTK) | Low |
| **Dioxus Mobile** | Mobile | *(same repo)* | Cargo Mobile 2 — experimental | 🔴 Early-stage | Reuses mobile scaffold + Dioxus desktop learnings | Cargo Mobile 2 maturity, platform bridge stability | High |
| **React Native Desktop** | Desktop | *(same repo)* | Less mature than mobile counterpart | 🟡 Emerging | Leverages Phase 2 mobile experience | React Native Desktop renderer maturity | Medium–High |

---

## Planned Services

### Phase 1: Dioxus Desktop (Q2 2026)
**Priority:** High - Emerging Rust ecosystem integration

**Target Platforms:** Windows, macOS, Linux

**Why Dioxus first:**
- Modern Rust-based framework gaining traction
- Similar architecture to Tauri (leverage existing patterns)
- Desktop-first approach aligns with current offerings
- Growing community interest

**Technical approach:**
- Wry webview automation (WebView2/WKWebView/WebKitGTK)
- DevTools protocol via CDP sessions (standard Chromedriver)
- Standard WDIO parallelization
- Reuses Tauri service launch detection patterns

### Phase 2: React Native Mobile (Q3 2026)
**Priority:** High - Mobile testing expansion

**Target Platforms:** iOS, Android
**Future:** Windows, macOS, Linux (desktop support)

**Why React Native:**
- Massive ecosystem and user base
- Well-established mobile testing needs
- Appium integration already proven
- Establishes mobile scaffold pattern

**Technical approach:**
- Appium server + hybrid context switching
- XCUITest driver (iOS)
- UiAutomator2 driver (Android)
- Standard WebdriverIO Appium patterns

### Phase 3: Flutter Mobile (Q4 2026)
**Priority:** Medium - Mobile testing completion

**Target Platforms:** iOS, Android

**Why Flutter:**
- Google backing and strong mobile presence
- Production-ready Appium Flutter Driver
- Complements React Native mobile coverage
- Reuses mobile scaffold

**Technical approach:**
- Appium Flutter Driver integration
- Standard WebdriverIO Appium patterns

### Phase 4: Capacitor Mobile (Q1 2027)
**Priority:** Medium - Ionic ecosystem coverage

**Target Platforms:** iOS, Android

**Why Capacitor:**
- Ionic's 1M+ app ecosystem
- Pure WebView pattern (zero new complexity)
- Replaces deprecated Cordova/PhoneGap
- Perfect mobile scaffold consumer

**Technical approach:**
- Standard Appium WebView context switching
- appPackage/appActivity capabilities

### Phase 5: Electrobun Desktop (Q2 2027)
**Priority:** Medium - Emerging TypeScript-first desktop framework

**Target Platforms:** macOS 14+, Windows 11+, Linux (Ubuntu 22.04+)

**Why Electrobun:**
- Growing momentum in the lightweight desktop space (~12MB bundles, sub-50ms startup)
- TypeScript-first authoring with Bun runtime, no Node.js requirement
- System webview model aligns with Tauri/Dioxus patterns
- MIT-licensed; v1 line shipped, APIs still stabilizing

**Technical approach:**
- Direct CDP attachment via WebSocket on the underlying webview's debugger port (the third-party [agent-electrobun](https://github.com/Ataraxy-Labs/agent-electrobun) CLI defaults to 9222 for Electrobun apps; the WDIO service will define its own override mechanism rather than rely on a built-in Electrobun env var)
- No external driver process — connect like Electron, not Tauri
- Multi-target session management for OOPIF webviews (shell vs per-tab CDP targets, classified by URL path)
- Observation/input-only protocol calls — no `Page.navigate` on attach (would destroy app state)
- Reuse `@wdio/electron-cdp-bridge` patterns; likely add a sibling bridge with multi-target routing

### Phase 6: Neutralino Desktop (Q3 2027)
**Priority:** Low - Niche use case

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

### Phase 7: Dioxus Mobile Experimental (Q4 2027)
**Priority:** Low - Experimental platform

**Target Platforms:** iOS, Android (experimental)

**Why experimental:**
- Dioxus mobile is early-stage
- Reuses established mobile scaffold
- Completes Rust ecosystem coverage

### Phase 8: React Native Desktop (Q1 2028)
**Priority:** Low - Desktop expansion

**Target Platforms:** Windows, macOS, Linux

**Why later:**
- Less mature than React Native mobile
- Lower demand vs mobile priorities
- Leverages Phase 2 mobile experience



## Not Planned

The following frameworks were evaluated and excluded from the roadmap:

| Framework | Reason |
|---|---|
| NW.js | Declining popularity, overlaps with Electron |
| Cordova / PhoneGap | Deprecated (2020), replaced by Capacitor |
| Qt / QML | Native rendering — no WebDriver fit |
| .NET MAUI | Native UI, platform-specific drivers required |
| Blazor | Standard web needs no service; Hybrid WebView context switching unreliable |
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
