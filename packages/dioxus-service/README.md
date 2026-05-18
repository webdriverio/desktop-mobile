# @wdio/dioxus-service

[![@wdio/dioxus-service](https://img.shields.io/badge/@wdio-dioxus--service-8B5CF6?labelColor=1a1a1a&style=plastic)](https://www.npmjs.com/package/@wdio/dioxus-service)
[![Version](https://img.shields.io/npm/v/@wdio/dioxus-service?color=28a745&labelColor=1a1a1a)](https://www.npmjs.com/package/@wdio/dioxus-service)
[![Downloads](https://img.shields.io/npm/dw/@wdio/dioxus-service?color=6f42c1&labelColor=1a1a1a)](https://www.npmjs.com/package/@wdio/dioxus-service)

WebdriverIO service for testing Dioxus desktop applications on Windows, Linux, and macOS.

Enables cross-platform E2E testing of Dioxus apps via the extensive WebdriverIO ecosystem.

## Features

- 🚗 Embedded WebDriver server — no external driver required on any platform
- 🔧 Automatic Edge WebDriver management on Windows (`'external'` provider)
- 📦 Automatic Dioxus binary path detection
- 🌐 Cross-platform support (Windows, Linux, macOS)
- 🔗 Full Dioxus API access via `browser.dioxus.execute()`
- 🧩 Mocking support for Dioxus `invoke` commands
- 📊 Backend and frontend log capture
- 🖥️ Multiremote testing support
- 🏃 Per-worker driver spawning for parallel testing
- 🌍 Browser mode — test the Dioxus frontend in plain Chrome against a dev server, no binary or driver required

## Installation

Install the service via npm:

```bash
npm install --save-dev @wdio/dioxus-service
```

Or with pnpm:

```bash
pnpm add -D @wdio/dioxus-service
```

## Quick Start

Get started in minutes with the [Quick Start Guide](./docs/quick-start.md).

### Minimal Configuration

Add to your `wdio.conf.ts`:

```typescript
export const config = {
  services: ['@wdio/dioxus-service'],

  capabilities: [
    {
      browserName: 'dioxus',
      'dioxus:options': {
        application: './target/debug/my-app'
      }
    }
  ]
};
```

See [Configuration Reference](./docs/configuration.md) for all options.

## Documentation

**Getting Started**
- [Quick Start Guide](./docs/quick-start.md) - Set up in minutes
- [Bridge Setup](./docs/plugin-setup.md) - Install wdio-dioxus-bridge

**Reference**
- [Configuration](./docs/configuration.md) - All service options
- [API Reference](./docs/api-reference.md) - Complete API documentation
- [Platform Support](./docs/platform-support.md) - Windows, Linux, macOS

**Guides**
- [Browser Mode](./docs/browser-mode.md) - Test the renderer in Chrome without a Dioxus binary
- [Usage Examples](./docs/usage-examples.md) - Common testing patterns
- [Log Forwarding](./docs/log-forwarding.md) - Capture app logs
- [Edge WebDriver (Windows)](./docs/edge-webdriver-windows.md) - Windows `'external'` provider setup
- [Deeplink Testing](./docs/deeplink-testing.md) - Test protocol handlers
- [Coexistence](./docs/coexistence.md) - Using alongside Tauri and Electron services
- [Visual Testing](../../docs/visual-testing.md) - Visual regression with `@wdio/visual-service`

**Help & Support**
- [Troubleshooting](./docs/troubleshooting.md) - Common issues and solutions
- [Development](./docs/development.md) - Contributing guide

## Platform Support

| Platform | Supported | Driver Providers | Notes |
|----------|-----------|------------------|-------|
| **Windows** | ✅ Yes | `'embedded'`, `'external'` | `'embedded'` recommended; `'external'` requires `wdio-dioxus-driver` + msedgedriver |
| **Linux** | ✅ Yes | `'embedded'` only | `'external'` blocked in v1 (upstream Dioxus PR pending) |
| **macOS** | ✅ Yes | `'embedded'` only | `'external'` not supported |

See [Platform Support](./docs/platform-support.md) for detailed information.

> **Choosing a driver provider:**
> - **`'embedded'`** (recommended) — Native support on all three platforms, no external driver needed
> - **`'external'`** — Windows only in v1; uses `wdio-dioxus-driver` + msedgedriver

## Example Projects

Check out the E2E test fixtures in the [desktop-mobile repository](https://github.com/webdriverio/desktop-mobile/tree/main/fixtures/e2e-apps/dioxus) for complete working examples.

## Support

Having trouble? Here are some resources:

1. **[Troubleshooting Guide](./docs/troubleshooting.md)** - Solutions for common issues
2. **[Platform Support](./docs/platform-support.md)** - Platform-specific information
3. **[GitHub Issues](https://github.com/webdriverio/desktop-mobile/issues)** - Bug reports and feature requests
4. **[WebdriverIO Forum](https://github.com/webdriverio/webdriverio/discussions)** - General community help and discussions

## Contributing

We welcome contributions! Please see our [Development Guide](./docs/development.md) for:

- Setting up your development environment
- Running tests
- Code style guidelines
- Pull request process

Quick start for contributors:

```bash
# Clone and install
git clone https://github.com/webdriverio/desktop-mobile.git
cd desktop-mobile
pnpm install

# Make your changes
# ...

# Run tests
pnpm test

# Submit a pull request
```

## License

MIT License. See LICENSE file for details.

## See Also

- [WebdriverIO Documentation](https://webdriver.io)
- [Dioxus Documentation](https://dioxuslabs.com/learn/0.6/)
- [@wdio/tauri-service](https://github.com/webdriverio/desktop-mobile/tree/main/packages/tauri-service) - Similar service for Tauri apps
- [@wdio/electron-service](https://github.com/webdriverio/desktop-mobile/tree/main/packages/electron-service) - Similar service for Electron apps
