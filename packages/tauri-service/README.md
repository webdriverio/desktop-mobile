# @wdio/tauri-service

[![@wdio/tauri-service](https://img.shields.io/badge/@wdio-tauri--service-FFC131?labelColor=1a1a1a&style=plastic)](https://www.npmjs.com/package/@wdio/tauri-service)
[![Version](https://img.shields.io/npm/v/@wdio/tauri-service?color=28a745&labelColor=1a1a1a)](https://www.npmjs.com/package/@wdio/tauri-service)
[![Downloads](https://img.shields.io/npm/dw/@wdio/tauri-service?color=6f42c1&labelColor=1a1a1a)](https://www.npmjs.com/package/@wdio/tauri-service)

WebdriverIO service for testing Tauri applications on Windows, Linux, and macOS.

Enables cross-platform E2E testing of Tauri apps via the extensive WebdriverIO ecosystem.

## Features

- 🚗 Automatic tauri-driver installation and management
- 🔧 Automatic Edge WebDriver management on Windows
- 📦 Automatic Tauri binary path detection
- 🌐 Cross-platform support (Windows, Linux, macOS)
- 🔗 Full Tauri API access via `browser.tauri.execute()`
- 🧩 Mocking support for Tauri's invoke API
- 📊 Backend and frontend log capture
- 🖥️ Multiremote testing support
- 🏃 Per-worker driver spawning for parallel testing
- 🌍 Browser mode — test the Tauri frontend in plain Chrome against a Vite dev server, no Tauri binary or driver required

## Installation

Install the service via npm:

```bash
npm install --save-dev @wdio/tauri-service
```

Or with pnpm:

```bash
pnpm add -D @wdio/tauri-service
```

## Quick Start

Get started in minutes with the [Quick Start Guide](./docs/quick-start.md).

### Minimal Configuration

Add to your `wdio.conf.ts`:

```typescript
export const config = {
  services: ['@wdio/tauri-service'],

  capabilities: [
    {
      browserName: 'tauri',
      'tauri:options': {
        application: './src-tauri/target/release/my-app.exe'
      }
    }
  ]
};
```

See [Configuration Reference](./docs/configuration.md) for all options.

## Documentation

**Getting Started**
- [Quick Start Guide](./docs/quick-start.md) - Set up in minutes
- [Plugin Setup](./docs/plugin-setup.md) - Install tauri-plugin-wdio

**Reference**
- [Configuration](./docs/configuration.md) - All service options
- [API Reference](./docs/api-reference.md) - Complete API documentation
- [Platform Support](./docs/platform-support.md) - Windows, Linux, macOS

**Guides**
- [Browser Mode](./docs/browser-mode.md) - Test the renderer in Chrome without a Tauri binary
- [Usage Examples](./docs/usage-examples.md) - Common testing patterns
- [Log Forwarding](./docs/log-forwarding.md) - Capture app logs
- [Edge WebDriver (Windows)](./docs/edge-webdriver-windows.md) - Windows-specific setup
- [Deeplink Testing](./docs/deeplink-testing.md) - Test protocol handlers
- [Visual Testing](../../docs/visual-testing.md) - Visual regression with `@wdio/visual-service`
- [Video Recording](../../docs/video-recording.md) - Record video of test runs with `wdio-video-reporter`

**Help & Support**
- [Troubleshooting](./docs/troubleshooting.md) - Common issues and solutions
- [Development](./docs/development.md) - Contributing guide

## Platform Support

| Platform | Supported | Driver Providers | Notes |
|----------|-----------|------------------|-------|
| **Windows** | ✅ Yes | `embedded`, `external`, `crabnebula` | `external` auto-manages the Edge WebDriver |
| **Linux** | ✅ Yes | `embedded`, `external`, `crabnebula` | `external` requires `webkit2gtk-driver` |
| **macOS** | ✅ Yes | `embedded`, `crabnebula` | Native via embedded, or CrabNebula |

See [Platform Support](./docs/platform-support.md) for detailed information including distribution support and troubleshooting.

> **Choosing a driver provider** (see [ADR 0001](https://github.com/webdriverio/desktop-mobile/blob/main/docs/adr/0001-driver-provider-naming.md) for the naming):
> - **`embedded`** (default, all platforms) — WebDriver runs inside your app; no external driver needed
> - **`external`** — a separate `tauri-driver` process; Windows/Linux only
> - **`crabnebula`** — CrabNebula's cross-platform driver; requires a subscription (CN_API_KEY for macOS)
>
> `driverProvider: 'official'` is a deprecated alias for `'external'` and will be removed in v2.

## Example Projects

Check out the E2E test fixtures in the [desktop-mobile repository](https://github.com/webdriverio/desktop-mobile/tree/main/fixtures/e2e-apps/tauri) for complete working examples.

## Support

Having trouble? Here are some resources:

1. **[Troubleshooting Guide](./docs/troubleshooting.md)** - Solutions for common issues
2. **[Platform Support](./docs/platform-support.md)** - Platform-specific information
3. **[GitHub Issues](https://github.com/webdriverio/desktop-mobile/issues)** - Bug reports and feature requests for tauri-service
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
- [Tauri Documentation](https://v2.tauri.app)
- [@wdio/electron-service](https://github.com/webdriverio/desktop-mobile/tree/main/packages/electron-service) - Similar service for Electron apps
