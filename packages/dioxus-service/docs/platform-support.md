# Platform Support

Complete guide to platform-specific requirements, limitations, and driver setup for Dioxus testing.

## Platform Support Overview

| Platform | Supported | Driver Providers | Notes |
|----------|-----------|-----------------|-------|
| **Windows** | ✅ Yes | `'embedded'` | `'external'` isn't available yet ([#713](https://github.com/webdriverio/desktop-mobile/issues/713)) |
| **Linux** | ✅ Yes | `'embedded'` | `'external'` also needs an upstream Dioxus change ([#712](https://github.com/webdriverio/desktop-mobile/issues/712)) |
| **macOS** | ✅ Yes | `'embedded'` | `'external'` can't be supported |

## Driver Providers

### `'embedded'` (Recommended Everywhere)

The embedded WebDriver provider uses `wdio-dioxus-embedded-driver` wired into the app via `wdio_dioxus_embedded_driver::install(config)`, which also installs the bridge. No external driver process is needed.

**Works on:** Windows, Linux, macOS

**Requirements:**
- `wdio-dioxus-embedded-driver = "1"` in `Cargo.toml`
- `wdio_dioxus_embedded_driver::install(config)` in `main.rs` inside `#[cfg(debug_assertions)]` (`wdio_dioxus_bridge::install(config)` alone doesn't start the WebDriver server)
- Debug build of the app (`dx build --desktop`; see [App Setup](./app-setup.md#step-3-build-in-debug-mode) for why not `cargo build`)

**Configuration:**
```typescript
services: [['@wdio/dioxus-service', {
  driverProvider: 'embedded',  // Default, recommended
}]]
```

### `'external'` (Not Available Yet)

The external provider would use `wdio-dioxus-driver` (a fork of `tauri-driver`) + `msedgedriver.exe`. It isn't available yet: the service doesn't start `wdio-dioxus-driver`, so selecting `'external'` fails at startup on every platform.

- **Windows:** planned ([#713](https://github.com/webdriverio/desktop-mobile/issues/713))
- **Linux:** also needs an upstream Dioxus change that allows WebKit automation ([#712](https://github.com/webdriverio/desktop-mobile/issues/712))
- **macOS:** can't be supported; no WebDriver can drive an embedded WKWebView

## Windows

### `'embedded'` Provider (Recommended)

No external driver needed. Ensure the embedded driver is installed in your app and use a debug build.

```typescript
services: [['@wdio/dioxus-service', {
  driverProvider: 'embedded',
  appBinaryPath: './target/dx/my_app/debug/windows/app/my_app.exe',
}]]
```

### `'external'` Provider

Not available yet ([#713](https://github.com/webdriverio/desktop-mobile/issues/713)).

### Windows-Specific Features

- ✅ Full Dioxus invoke API via `browser.dioxus.execute()`
- ✅ Command mocking
- ✅ Log capture (frontend and backend)
- ✅ Screenshot capture
- ✅ Multiremote testing

### Windows Requirements

- **Visual C++ Build Tools** or Visual Studio
- **Rust toolchain**
- **Node.js 18+**

## Linux

### `'embedded'` Provider Only

`'external'` isn't available on Linux. Besides the launcher support missing on every platform ([#713](https://github.com/webdriverio/desktop-mobile/issues/713)), WebKitWebDriver can only drive a WebKit context that allows automation, and Dioxus doesn't let apps allow it yet ([#712](https://github.com/webdriverio/desktop-mobile/issues/712)).

Attempting to set `driverProvider: 'external'` on Linux throws a `SevereServiceError` at startup with an explanatory message.

**Configuration:**
```typescript
services: [['@wdio/dioxus-service', {
  driverProvider: 'embedded',  // The only supported option on Linux
  appBinaryPath: './target/dx/my_app/debug/linux/app/my_app',
}]]
```

### Linux Build Requirements

Install WebKitGTK libraries (required to build Dioxus desktop apps):

```bash
# Debian/Ubuntu
sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev

# Fedora
sudo dnf install -y webkit2gtk4.1-devel gtk3-devel

# Arch Linux
sudo pacman -S webkit2gtk-4.1 gtk3
```

### Headless Testing on Linux

To run tests without a display (CI/CD environments):

```bash
# With Xvfb
sudo apt-get install -y xvfb
xvfb-run -a npx wdio run wdio.conf.ts
```

### Linux-Specific Features

- ✅ Full Dioxus invoke API
- ✅ Command mocking
- ✅ Log capture
- ✅ Screenshot capture
- ✅ Headless testing with Xvfb
- ✅ Multiremote testing
- ❌ `'external'` provider ([#712](https://github.com/webdriverio/desktop-mobile/issues/712))

### Linux Distribution Support

| Distribution | Status |
|-------------|--------|
| Debian / Ubuntu 22.04+ | ✅ Supported |
| Fedora 40+ | ✅ Supported |
| Arch Linux | ✅ Supported |
| Alpine Linux | ❌ Not supported (musl incompatibility) |

## macOS

### `'embedded'` Provider Only

`'external'` is not supported on macOS and never will be — it inherits the same WKWebView limitation as the upstream `tauri-driver` fork it is based on.

**Configuration:**
```typescript
services: [['@wdio/dioxus-service', {
  driverProvider: 'embedded',  // Default, and the only option on macOS
  appBinaryPath: './target/dx/my_app/debug/macos/MyApp.app/Contents/MacOS/my_app',
}]]
```

### macOS-Specific Features

- ✅ Full Dioxus invoke API
- ✅ Command mocking
- ✅ Log capture
- ✅ Screenshot capture
- ✅ Multiremote testing
- ❌ `'external'` provider (not supported, no timeline)

## Cross-Platform Tips

### Recommended CI Matrix

```yaml
# .github/workflows/e2e.yml
jobs:
  e2e:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable

      - name: Install Linux dependencies
        if: runner.os == 'Linux'
        run: sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev xvfb

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - run: npm install
      - uses: cargo-bins/cargo-binstall@main
      - run: cargo binstall dioxus-cli --no-confirm
      - run: dx build --desktop

      - name: Run E2E (Linux, headless)
        if: runner.os == 'Linux'
        run: xvfb-run -a npm run test:e2e

      - name: Run E2E (Windows / macOS)
        if: runner.os != 'Linux'
        run: npm run test:e2e
```

### Platform-Conditional Tests

```typescript
describe('Platform-specific features', () => {
  it('should handle Windows path format', function() {
    if (process.platform !== 'win32') {
      this.skip();
    }
    // Windows-specific test
  });

  it('should handle Linux file permissions', function() {
    if (process.platform !== 'linux') {
      this.skip();
    }
    // Linux-specific test
  });
});
```

## Summary

| Provider | Windows | Linux | macOS |
|----------|---------|-------|-------|
| `'embedded'` | ✅ | ✅ | ✅ |
| `'external'` | ❌ ([#713](https://github.com/webdriverio/desktop-mobile/issues/713)) | ❌ ([#712](https://github.com/webdriverio/desktop-mobile/issues/712)) | ❌ (never) |

Use `'embedded'` everywhere for the simplest, most consistent setup.

## See Also

- [Quick Start](./quick-start.md) for setup instructions
- [Edge WebDriver (Windows)](./edge-webdriver-windows.md) for the planned Windows `'external'` provider
- [Troubleshooting](./troubleshooting.md) for common issues
