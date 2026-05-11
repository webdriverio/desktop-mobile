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
        <a href="https://www.npmjs.com/package/@wdio/electron-service"><img src="https://img.shields.io/npm/dw/@wdio/electron-service" alt="npm downloads" /></a>
    </div>
</h4>

[`@wdio/electron-service`](./packages/electron-service) - Electron applications (Windows / macOS / Linux)

<h4>
  <div>
    <a href="https://www.npmjs.com/package/@wdio/tauri-service"><img src="https://img.shields.io/badge/@wdio-tauri--service-FFC131?labelColor=1a1a1a&style=plastic" alt="npm package" /></a>
    <a href="https://www.npmjs.com/package/@wdio/tauri-service"><img src="https://img.shields.io/npm/v/@wdio/tauri-service" alt="npm version" /></a>
    <a href="https://www.npmjs.com/package/@wdio/tauri-service"><img src="https://img.shields.io/npm/dw/@wdio/tauri-service" alt="npm downloads" /></a>
  </div>
</h4>

[`@wdio/tauri-service`](./packages/tauri-service) - Tauri applications (Windows / macOS / Linux)

## Planned Support

- **Dioxus** - Modern cross-platform UI framework
- **React Native** - Popular mobile and desktop framework
- **Flutter** - Google's UI toolkit for mobile and beyond
- **Capacitor** - Ionic's cross-platform mobile framework
- **Electrobun** - TypeScript-first desktop apps with system webviews and the Bun runtime
- **Neutralino** - Lightweight desktop applications

See [ROADMAP.md](./ROADMAP.md) for detailed sequencing, os support, and timelines.

## Features

- 🎯 **Framework-specific automation** - Native integration with Electron, Tauri
- 🔍 **Smart binary detection** - Automatic app discovery and configuration
- 🎭 **API mocking & isolation** - Built-in mocking for deterministic tests
- 🌍 **Browser-only test mode** - Run the renderer in Chrome against a dev server (no binary required) — available for [Electron](./packages/electron-service/docs/browser-mode.md) and [Tauri](./packages/tauri-service/docs/browser-mode.md)
- 🌐 **Cross-platform support** - Write once, test everywhere
- 🔧 **Consistent API** - Familiar WDIO patterns across all frameworks

## Project Structure

```
desktop-mobile/
├── packages/                    # Service packages
│   ├── electron-service/        # Electron service implementation
│   ├── tauri-service/           # Tauri service implementation
│   ├── electron-cdp-bridge/     # Chrome DevTools Protocol bridge
│   ├── native-utils/            # Cross-platform utilities
│   ├── native-types/            # TypeScript type definitions
│   ├── native-spy/              # Spy utilities for mocking
│   ├── bundler/                 # Build tool for packaging
│   └── tauri-plugin/            # Tauri plugin for backend access
├── fixtures/                   # Test fixtures and example apps
│   ├── e2e-apps/               # E2E test applications
│   ├── package-tests/          # Package integration tests
│   └── config-formats/         # Configuration format test fixtures
├── e2e/                        # End-to-end test suites
│   ├── test/                   # Test specifications
│   │   ├── electron/           # Electron E2E tests
│   │   └── tauri/              # Tauri E2E tests
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
