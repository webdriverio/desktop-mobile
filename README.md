<!-- Logo placeholder - uncomment and add logo URL when available
<p align="center">
    <a href="https://github.com/webdriverio/desktop-mobile">
        <img alt="WebdriverIO Desktop & Mobile" src="[LOGO-URL-HERE]" width="146">
    </a>
</p>
-->

<p align="center">
    <strong>WebdriverIO Desktop & Mobile Testing</strong>
</p>

<p align="center">
    WebdriverIO services for automated testing of native desktop and mobile applications
</p>

<p align="center">
    <a href="https://github.com/webdriverio/desktop-mobile/actions/workflows/ci.yml"><img alt="Build Status" src="https://github.com/webdriverio/desktop-mobile/actions/workflows/ci.yml/badge.svg"></a>
    <a href="https://github.com/webdriverio/desktop-mobile/blob/main/LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg"></a>
    <a href="https://discord.webdriver.io"><img alt="Discord" src="https://img.shields.io/discord/1097401827202445382?color=%234FB898&label=Discord"></a>
</p>

---

<p align="center">
    <a href="#features">Features</a> |
    <a href="#development">Development</a> |
    <a href="./CONTRIBUTING.md">Contribute</a> |
    <a href="./CHANGELOG.md">Changelog</a>
</p>

## Supported Frameworks

<h4>
    <div>
        <a href="https://www.npmjs.com/package/@wdio/electron-service"><img src="https://img.shields.io/badge/@wdio-electron--service-9feaf9?labelColor=1a1a1a&style=plastic" alt="npm package" /></a>
        <a href="https://www.npmjs.com/package/@wdio/electron-service"><img src="https://img.shields.io/npm/v/@wdio/electron-service" alt="npm version" /></a>
        <a href="https://www.npmjs.com/package/@wdio/electron-service"><img src="https://img.shields.io/npm/dw/@wdio/electron-service?label=downloads%20(v10%2B)" alt="npm downloads (v10+)" /></a>
        <a href="https://www.npmjs.com/package/wdio-electron-service"><img src="https://img.shields.io/npm/dw/wdio-electron-service?label=downloads%20(%E2%89%A4%20v9)" alt="npm downloads (legacy wdio-electron-service, ≤ v9)" /></a>
    </div>
</h4>

[`@wdio/electron-service`](./packages/electron-service) — Electron (Windows / macOS / Linux)

<h4>
  <div>
    <a href="https://www.npmjs.com/package/@wdio/tauri-service"><img src="https://img.shields.io/badge/@wdio-tauri--service-FFC131?labelColor=1a1a1a&style=plastic" alt="npm package" /></a>
    <a href="https://www.npmjs.com/package/@wdio/tauri-service"><img src="https://img.shields.io/npm/v/@wdio/tauri-service" alt="npm version" /></a>
    <a href="https://www.npmjs.com/package/@wdio/tauri-service"><img src="https://img.shields.io/npm/dw/@wdio/tauri-service" alt="npm downloads" /></a>
  </div>
</h4>

[`@wdio/tauri-service`](./packages/tauri-service) — Tauri (Windows / macOS / Linux)

## Pre-release

> Feature-complete services published under the `next` dist-tag (`1.0.0-next.x`). Install with `@next` — e.g. `npm install @wdio/react-native-service@next`. Expect `1.0.0` stable releases as the services stabilise.

<h4>
  <div>
    <a href="https://www.npmjs.com/package/@wdio/dioxus-service"><img src="https://img.shields.io/badge/@wdio-dioxus--service-8B5CF6?labelColor=1a1a1a&style=plastic" alt="npm package" /></a>
    <a href="https://www.npmjs.com/package/@wdio/dioxus-service"><img src="https://img.shields.io/npm/v/@wdio/dioxus-service/next" alt="npm version (next)" /></a>
    <a href="https://www.npmjs.com/package/@wdio/dioxus-service"><img src="https://img.shields.io/npm/dw/@wdio/dioxus-service" alt="npm downloads" /></a>
  </div>
</h4>

[`@wdio/dioxus-service`](./packages/dioxus-service) — Dioxus (Windows / macOS / Linux)

<h4>
  <div>
    <a href="https://www.npmjs.com/package/@wdio/react-native-service"><img src="https://img.shields.io/badge/@wdio-react--native--service-61DAFB?labelColor=1a1a1a&style=plastic" alt="npm package" /></a>
    <a href="https://www.npmjs.com/package/@wdio/react-native-service"><img src="https://img.shields.io/npm/v/@wdio/react-native-service/next" alt="npm version (next)" /></a>
    <a href="https://www.npmjs.com/package/@wdio/react-native-service"><img src="https://img.shields.io/npm/dw/@wdio/react-native-service" alt="npm downloads" /></a>
  </div>
</h4>

[`@wdio/react-native-service`](./packages/react-native-service) — React Native (Android / iOS)

<h4>
  <div>
    <a href="https://www.npmjs.com/package/@wdio/flutter-service"><img src="https://img.shields.io/badge/@wdio-flutter--service-54C5F8?labelColor=1a1a1a&style=plastic" alt="npm package" /></a>
    <a href="https://www.npmjs.com/package/@wdio/flutter-service"><img src="https://img.shields.io/npm/v/@wdio/flutter-service/next" alt="npm version (next)" /></a>
    <a href="https://www.npmjs.com/package/@wdio/flutter-service"><img src="https://img.shields.io/npm/dw/@wdio/flutter-service" alt="npm downloads" /></a>
  </div>
</h4>

[`@wdio/flutter-service`](./packages/flutter-service) — Flutter (Android / iOS)

## Early Support

> Early (`0.x`) support — feature surface is limited by upstream gaps. Not yet at parity with the services above.

<h4>
  <div>
    <a href="https://www.npmjs.com/package/@wdio/electrobun-service"><img src="https://img.shields.io/badge/@wdio-electrobun--service-E8590C?labelColor=1a1a1a&style=plastic" alt="npm package" /></a>
    <a href="https://www.npmjs.com/package/@wdio/electrobun-service"><img src="https://img.shields.io/npm/v/@wdio/electrobun-service" alt="npm version" /></a>
    <a href="https://www.npmjs.com/package/@wdio/electrobun-service"><img src="https://img.shields.io/npm/dw/@wdio/electrobun-service" alt="npm downloads" /></a>
  </div>
</h4>

[`@wdio/electrobun-service`](./packages/electrobun-service) — Electrobun (macOS / Windows)
Linux is upstream-blocked; macOS deeplink + multiremote are upstream-blocked. See the [package README](./packages/electrobun-service).

## Planned Support

- **Capacitor** - Ionic's cross-platform mobile framework
- **Neutralino** - Lightweight desktop applications

See [ROADMAP.md](./ROADMAP.md) for detailed sequencing, os support, and timelines.

## Features

- 🎯 **Framework-specific automation** - Native integration with Electron, Tauri, Dioxus, React Native, Flutter, Electrobun
- 🔍 **Smart binary detection** - Automatic app discovery and configuration
- 🎭 **API mocking & isolation** - Built-in mocking for deterministic tests
- 📱 **Native mobile automation** - Appium-driven UI interaction (UiAutomator2 / XCUITest / appium-flutter-driver) for Android + iOS
- 🌍 **Browser-only test mode** - Run the renderer in Chrome against a dev server, no binary required. See the [Electron](./packages/electron-service/docs/browser-mode.md), [Tauri](./packages/tauri-service/docs/browser-mode.md), and [Dioxus](./packages/dioxus-service/docs/browser-mode.md) guides.
- 🌐 **Cross-platform support** - Write once, test everywhere
- 🔧 **Consistent API** - Familiar WDIO patterns across all frameworks

## Project Structure

```
desktop-mobile/
├── packages/                    # Service packages
│   ├── electron-service/        # Electron service implementation
│   ├── tauri-service/           # Tauri service implementation
│   ├── dioxus-service/          # Dioxus service implementation
│   ├── electrobun-service/      # Electrobun service implementation
│   ├── electron-cdp-bridge/     # Chrome DevTools Protocol bridge (Electron)
│   ├── native-cdp-bridge/      # Shared CDP bridge (single + multi-target)
│   ├── native-utils/            # Cross-platform utilities
│   ├── native-types/            # TypeScript type definitions
│   ├── native-spy/              # Spy utilities for mocking
│   ├── bundler/                 # Build tool for packaging
│   ├── tauri-plugin/            # Tauri plugin for backend access
│   ├── dioxus-bridge/           # Dioxus bridge crate (Rust)
│   ├── dioxus-embedded-driver/  # Dioxus embedded WebDriver server (Rust)
│   └── dioxus-driver/           # Dioxus external WebDriver proxy (Rust, Windows)
├── fixtures/                   # Test fixtures and example apps
│   ├── e2e-apps/               # E2E test applications
│   ├── package-tests/          # Package integration tests
│   └── config-formats/         # Configuration format test fixtures
├── e2e/                        # End-to-end test suites
│   ├── test/                   # Test specifications
│   │   ├── electron/           # Electron E2E tests
│   │   ├── tauri/              # Tauri E2E tests
│   │   └── dioxus/             # Dioxus E2E tests
│   └── scripts/                # Test execution scripts
├── docs/                       # Documentation
└── scripts/                    # Build and utility scripts
```


## Development

### Requirements

- Node.js 24 LTS
- pnpm 10.27.0

### Setup

```bash
pnpm install  # Install dependencies
pnpm build    # Build all packages
pnpm test     # Run tests
```

See [docs/setup.md](./docs/setup.md) for detailed setup instructions and [CONTRIBUTING.md](./CONTRIBUTING.md) for the full command reference.

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

## Architecture

Monorepo built with **Turborepo**, **pnpm workspaces**, and **TypeScript**. Each service integrates with WebdriverIO's test runner and provides framework-specific automation capabilities.

See [docs/architecture.md](./docs/architecture.md) for detailed architecture documentation and [docs/package-structure.md](./docs/package-structure.md) for package conventions.

## Documentation

| Document | Description |
|----------|-------------|
| [AGENTS.md](./AGENTS.md) | AI assistant context and coding standards |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Contribution guidelines |
| [ROADMAP.md](./ROADMAP.md) | Framework support roadmap |
| [MAINTENANCE.md](./MAINTENANCE.md) | Version support and maintenance policy |
| [SECURITY.md](./SECURITY.md) | Security policy and vulnerability reporting |
| [docs/setup.md](./docs/setup.md) | Detailed setup instructions |
| [docs/architecture.md](./docs/architecture.md) | Service architecture overview |
| [docs/e2e-testing.md](./docs/e2e-testing.md) | E2E testing guide |
| [docs/visual-testing.md](./docs/visual-testing.md) | Visual regression testing with `@wdio/visual-service` |
| [docs/package-structure.md](./docs/package-structure.md) | Package conventions |

## License

MIT License - see [LICENSE](LICENSE) for details.

## Maintenance Policy

> **Note:** This repository does not maintain LTS or backport branches. Only the latest version on `main` receives updates. See [MAINTENANCE.md](./MAINTENANCE.md) for details.

## Community & Support

- [WebdriverIO](https://webdriver.io) - Main WebdriverIO project
- [WebdriverIO Docs](https://webdriver.io/docs/gettingstarted) - Official documentation
- [WebdriverIO Community](https://github.com/webdriverio-community) - Community resources
- [Discord](https://discord.webdriver.io) - Join the WebdriverIO Discord for support
- [GitHub Issues](https://github.com/webdriverio/desktop-mobile/issues) - Bug reports and feature requests
- [GitHub Discussions](https://github.com/webdriverio/desktop-mobile/discussions) - Questions and ideas

## Related Projects

- [wdio-electron-service](https://github.com/webdriverio-community/wdio-electron-service) - Legacy Electron service repo
- [tauri-driver](https://github.com/tauri-apps/tauri/tree/dev/crates/tauri-driver) - Official Tauri WebDriver server
