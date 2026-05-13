# Platform Support

Complete guide to platform-specific requirements, limitations, and driver setup for Dioxus testing.

## Platform Support Overview

| Platform | Supported | Driver Providers | Notes |
|----------|-----------|-----------------|-------|
| **Windows** | ✅ Yes | `'embedded'`, `'external'` | `'embedded'` recommended; `'external'` requires wdio-dioxus-driver + msedgedriver |
| **Linux** | ✅ Yes | `'embedded'` only | `'external'` blocked in v1 — upstream Dioxus PR pending |
| **macOS** | ✅ Yes | `'embedded'` only | `'external'` not supported |

## Driver Providers

### `'embedded'` (Recommended Everywhere)

The embedded WebDriver provider uses `wdio-dioxus-embedded-driver` wired into the app via `wdio_dioxus_bridge::install(config)`. No external driver process is needed.

**Works on:** Windows, Linux, macOS

**Requirements:**
- `wdio-dioxus-bridge = "1"` in `Cargo.toml`
- `wdio_dioxus_bridge::install(config)` in `main.rs` inside `#[cfg(debug_assertions)]`
- Debug build of the app (`cargo build`)

**Configuration:**
```typescript
services: [['@wdio/dioxus-service', {
  driverProvider: 'embedded',  // Default, recommended
}]]
```

### `'external'` (Windows Only in v1)

The external provider uses `wdio-dioxus-driver` (a fork of `tauri-driver`) + `msedgedriver.exe`.

**Works on:** Windows only in v1

**Not supported on:** Linux (blocked — see below), macOS (never supported)

**Requirements:**
- `wdio-dioxus-driver` installed via `cargo install wdio-dioxus-driver`
- `msedgedriver.exe` (auto-managed by the service with `autoDownloadEdgeDriver: true`)

**Configuration:**
```typescript
services: [['@wdio/dioxus-service', {
  driverProvider: 'external',
  autoInstallDioxusDriver: true,
  autoDownloadEdgeDriver: true,
}]]
```

## Windows

### `'embedded'` Provider (Recommended)

No external driver needed. Ensure the bridge is in your app and use a debug build.

```typescript
services: [['@wdio/dioxus-service', {
  driverProvider: 'embedded',
  appBinaryPath: './target/debug/my_app.exe',
}]]
```

### `'external'` Provider

Uses `wdio-dioxus-driver` → `msedgedriver.exe` → Dioxus app via WebView2 automation.

**Setup:**

1. Build a debug binary: `cargo build`
2. Configure the service:
   ```typescript
   services: [['@wdio/dioxus-service', {
     driverProvider: 'external',
     autoInstallDioxusDriver: true,
     autoDownloadEdgeDriver: true,
     appBinaryPath: './target/debug/my_app.exe',
   }]]
   ```

The service auto-manages `msedgedriver.exe` to match the WebView2 version in your binary.

See [Edge WebDriver (Windows)](./edge-webdriver-windows.md) for detailed setup.

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
- For `'external'` provider: wdio-dioxus-driver + msedgedriver (auto-managed)

## Linux

### `'embedded'` Provider Only

`'external'` is blocked in v1 due to a missing upstream Dioxus API — the automation toggle that wdio-dioxus-driver needs to pass to Wry has not yet landed in the Dioxus/Wry codebase. This is tracked and will be enabled in v1.1 once the upstream PR merges.

Attempting to set `driverProvider: 'external'` on Linux throws a `SevereServiceError` at startup with an explanatory message.

**Configuration:**
```typescript
services: [['@wdio/dioxus-service', {
  driverProvider: 'embedded',  // The only supported option on Linux
  appBinaryPath: './target/debug/my_app',
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
- ❌ `'external'` provider (v1 — v1.1 target)

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
  appBinaryPath: './target/debug/my_app',
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
      - run: cargo build

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
| `'external'` | ✅ | ❌ (v1.1) | ❌ (never) |

Use `'embedded'` everywhere for the simplest, most consistent setup.

## See Also

- [Quick Start](./quick-start.md) for setup instructions
- [Edge WebDriver (Windows)](./edge-webdriver-windows.md) for Windows `'external'` details
- [Troubleshooting](./troubleshooting.md) for common issues
