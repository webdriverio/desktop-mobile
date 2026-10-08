# Platform Support

Platform-specific requirements and setup for Dioxus testing.

## Platform Support Overview

| Platform | Supported |
|----------|-----------|
| **Windows** | ✅ Yes |
| **Linux** | ✅ Yes |
| **macOS** | ✅ Yes |

## How the Service Drives Your App

The WebDriver server runs inside your app, so there's no driver to install on any platform. It comes from `wdio-dioxus-embedded-driver`, wired into the app via `wdio_dioxus_embedded_driver::install(config)`, which also installs the bridge.

**Requirements:**
- `wdio-dioxus-embedded-driver = "1"` in `Cargo.toml`
- `wdio_dioxus_embedded_driver::install(config)` in `main.rs` inside `#[cfg(debug_assertions)]` (`wdio_dioxus_bridge::install(config)` alone doesn't start the WebDriver server)
- Debug build of the app (`dx build --desktop`; see [App Setup](./app-setup.md#step-3-build-in-debug-mode) for why not `cargo build`)

## Windows

```typescript
services: [['@wdio/dioxus-service', {
  appBinaryPath: './target/dx/my_app/debug/windows/app/my_app.exe',
}]]
```

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

```typescript
services: [['@wdio/dioxus-service', {
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

### Linux Distribution Support

| Distribution | Status |
|-------------|--------|
| Debian / Ubuntu 22.04+ | ✅ Supported |
| Fedora 40+ | ✅ Supported |
| Arch Linux | ✅ Supported |
| Alpine Linux | ❌ Not supported (musl incompatibility) |

## macOS

```typescript
services: [['@wdio/dioxus-service', {
  appBinaryPath: './target/dx/my_app/debug/macos/MyApp.app/Contents/MacOS/my_app',
}]]
```

### macOS-Specific Features

- ✅ Full Dioxus invoke API
- ✅ Command mocking
- ✅ Log capture
- ✅ Screenshot capture
- ✅ Multiremote testing

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

## See Also

- [Quick Start](./quick-start.md) for setup instructions
- [Troubleshooting](./troubleshooting.md) for common issues
