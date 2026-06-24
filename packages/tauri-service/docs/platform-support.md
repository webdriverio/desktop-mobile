# Platform Support

Complete guide to platform-specific requirements, limitations, and WebDriver setup for Tauri testing.

## Platform Support Overview

| Platform | Supported | WebDriver | Driver Provider | Setup |
|----------|-----------|-----------|----------------|-------|
| **Windows** | ✅ Yes | Microsoft Edge WebDriver | All (`'embedded'`, `'external'`, `'crabnebula'`) | `'external'` auto-manages the Edge WebDriver |
| **Linux** | ✅ Yes | WebKitWebDriver | All (`'embedded'`, `'external'`, `'crabnebula'`) | `'external'` needs `webkit2gtk-driver` |
| **macOS** | ✅ Yes | Built-in | `'embedded'`, `'crabnebula'` | No external driver needed |

> `'embedded'` is the default on every platform when `driverProvider` is unset. `driverProvider: 'official'` is a deprecated alias for `'external'`. See [ADR 0001](https://github.com/webdriverio/desktop-mobile/blob/main/docs/adr/0001-driver-provider-naming.md).

## Windows

### WebDriver: Microsoft Edge WebDriver

Windows uses the **Microsoft Edge WebDriver** (msedgedriver.exe) which communicates with the WebView2 runtime embedded in your Tauri app.

#### Auto-Management (Recommended)

The service automatically:
1. Detects the WebView2 version in your Tauri binary
2. Downloads the matching MSEdgeDriver if missing
3. Handles version mismatches

**Configuration:**

```typescript
services: [['@wdio/tauri-service', {
  autoDownloadEdgeDriver: true,  // Default: true
}]],
```

#### Manual Setup

If auto-management fails:

1. **Detect your WebView2 version**
   - Build your app: `cargo build --release`
   - Right-click the .exe → Properties → Details
   - Note the "File version" (e.g., 143.0.3650.139)

2. **Download matching MSEdgeDriver**
   - Visit [Microsoft Edge WebDriver](https://developer.microsoft.com/en-us/microsoft-edge/tools/webdriver/)
   - Download the version matching your WebView2
   - Extract to PATH or specify in config

3. **Configure WebdriverIO**
   ```typescript
   services: [['@wdio/tauri-service', {
     autoDownloadEdgeDriver: false,
     tauriDriverPort: 4444,
   }]],
   ```

#### Troubleshooting Windows Issues

**"This version of Microsoft Edge WebDriver only supports Microsoft Edge version X"**

Version mismatch between driver and WebView2. Solutions:

1. Enable auto-download (default):
   ```typescript
   autoDownloadEdgeDriver: true
   ```

2. Or manually match versions:
   - Check WebView2 version in your binary
   - Download corresponding MSEdgeDriver
   - Update PATH or config

**"msedgedriver.exe not found"**

1. Check if installed:
   ```bash
   where msedgedriver.exe
   ```

2. Install or download from [Microsoft Edge WebDriver](https://developer.microsoft.com/en-us/microsoft-edge/tools/webdriver/)

3. Add to PATH or disable auto-download and specify manually

### Driver Providers on Windows

`'embedded'` is the default. All three providers work on Windows:

| Provider | Notes |
|----------|-------|
| `'embedded'` | Default — requires `tauri-plugin-wdio-webdriver` in your app; no external driver |
| `'external'` | Uses `tauri-driver` + MSEdgeDriver; the Edge WebDriver is auto-managed |
| `'crabnebula'` | Requires a paid CrabNebula API key; cross-platform alternative |

Use `'embedded'` for a consistent setup across Windows, Linux, and macOS without managing external drivers, `'external'` to drive `tauri-driver` directly, or `'crabnebula'` if you already have a CrabNebula subscription.

### Windows-Specific Features

- ✅ Full Tauri API support
- ✅ Command execution
- ✅ Mocking with tauri-plugin-wdio
- ✅ Log capture (frontend and backend)
- ✅ Screenshot capture
- ✅ File operations
- ✅ Multiremote testing

### Requirements

- **Visual C++ Build Tools** or Visual Studio
- **Rust toolchain** (for building Tauri apps)
- **Node.js 18+**

## Linux

### WebDriver: WebKitWebDriver

Linux uses **WebKitWebDriver** (WebKitGTK) which communicates with the Tauri app's WebKit runtime.

#### Installation by Distribution

**Debian/Ubuntu (✅ Supported)**

```bash
sudo apt-get update
sudo apt-get install -y webkit2gtk-driver

# Verify installation
which webkit2gtk-driver
```

**Fedora 40+ (✅ Supported)**

```bash
sudo dnf install -y webkit2gtk-driver

# Verify installation
which webkit2gtk-driver
```

**Arch Linux (✅ Supported)**

WebKitWebDriver is provided by webkit2gtk:

```bash
sudo pacman -S webkit2gtk-4.1

# Verify installation
which webkit2gtk-driver
```

**Void Linux (✅ Supported)**

```bash
sudo xbps-install -y webkit2gtk-devel

# Verify installation
which webkit2gtk-driver
```

**Alpine Linux (❌ Not Supported)**

Alpine uses musl C library which is incompatible with Tauri app building. Alpine can only be used as a **runtime container**, not for building Tauri apps.

**CentOS Stream / RHEL (❌ Not Supported)**

- **Stream 9 / RHEL 9**: glib 2.68 is too old (requires 2.70+)
- **Stream 10 / RHEL 10**: WebKitGTK intentionally removed due to security vulnerabilities

**Recommendation:** Use **Fedora 40+** for RHEL-based distributions.

**openSUSE / SUSE (❌ Not Supported)**

No official WebKitWebDriver package. Building from source is complex and not recommended.

**Other Distributions**

Check if webkit2gtk is available:

```bash
# Debian-based
apt search webkit2gtk-driver

# RedHat-based
dnf search webkit2gtk-driver

# Pacman-based
pacman -Ss webkit2gtk
```

#### Headless Testing

To run tests without a display (CI/CD environments):

**With Xvfb (X Virtual Framebuffer)**

Install Xvfb:

```bash
sudo apt-get install -y xvfb  # Debian/Ubuntu
sudo dnf install -y xvfb      # Fedora
```

Run tests:

```bash
xvfb-run -a npm run test:e2e
```

Or automatically via WebdriverIO (requires wdio 9.19.1+):

```typescript
services: [['@wdio/tauri-service', {
  // Xvfb is auto-detected and used if available
}]],
```

**With Wayland**

If you're on a Wayland desktop:

```bash
# Set XWayland if needed
export GDK_BACKEND=x11
npm run test:e2e
```

#### Troubleshooting Linux Issues

**"webkit2gtk-driver not found"**

1. Verify installation:
   ```bash
   which webkit2gtk-driver
   ```

2. If not found, install for your distribution (see above)

3. Add to PATH if in non-standard location:
   ```bash
   export PATH="/path/to/driver:$PATH"
   ```

**"X11 connection refused" or "Cannot open display"**

Your system doesn't have a display server. Solutions:

1. **Use Xvfb**
   ```bash
   xvfb-run -a npm run test:e2e
   ```

2. **Or use Docker with X11 forwarding**
   ```bash
   docker run -e DISPLAY -v /tmp/.X11-unix:/tmp/.X11-unix my-image
   ```

3. **Or enable headless mode** (if supported):
   ```bash
   export WAYLAND_DISPLAY=""
   npm run test:e2e
   ```

**"glib version too old"**

CentOS Stream / RHEL issue. Use **Fedora 40+** instead.

**"Permission denied" when installing webkit2gtk**

Use `sudo` for package installation:

```bash
sudo apt-get install webkit2gtk-driver
```

### Driver Providers on Linux

`'embedded'` is the default. All three providers work on Linux:

| Provider | Notes |
|----------|-------|
| `'embedded'` | Default — requires `tauri-plugin-wdio-webdriver` in your app; no external driver |
| `'external'` | Uses `tauri-driver` + WebKitWebDriver; requires `webkit2gtk-driver` (see above) |
| `'crabnebula'` | Requires a paid CrabNebula API key; cross-platform alternative |

Use `'embedded'` for a consistent setup across Windows, Linux, and macOS without managing external drivers, `'external'` to drive `tauri-driver` directly, or `'crabnebula'` if you already have a CrabNebula subscription.

### Linux-Specific Features

- ✅ Full Tauri API support
- ✅ Command execution
- ✅ Mocking with tauri-plugin-wdio
- ✅ Log capture (frontend and backend)
- ✅ Screenshot capture
- ✅ File operations
- ✅ Headless testing with Xvfb
- ✅ Multiremote testing

### Requirements

- **WebKitGTK development libraries** (webkit2gtk-driver) — only needed for the `'external'` provider
- **Xvfb** (optional, for headless testing)
- **Rust toolchain** (for building Tauri apps)
- **Node.js 18+**

## macOS

> **Note:** macOS testing is supported natively via the embedded WebDriver provider. On macOS the service **auto-detects** the embedded provider — no explicit `driverProvider` configuration is needed.

### Embedded Provider (Recommended)

The embedded WebDriver provider uses `tauri-plugin-wdio-webdriver` to provide native macOS support without requiring CrabNebula.

#### Requirements

1. Install `tauri-plugin-wdio-webdriver` in your Tauri app:
   ```bash
   cd src-tauri && cargo add tauri-plugin-wdio-webdriver
   ```

2. Register the plugin in your Rust code (debug builds only):
   ```rust
   fn main() {
       let builder = tauri::Builder::default();

       #[cfg(debug_assertions)]
       let builder = builder.plugin(tauri_plugin_wdio_webdriver::init());

       builder
           .run(tauri::generate_context!())
           .expect("error while running tauri application");
   }
   ```

3. Add permissions in `src-tauri/capabilities/default.json`:
   ```json
   {
     "permissions": [
       "core:default",
       "core:window:default",
       "wdio-webdriver:default"
     ]
   }
   ```

4. Configure WebdriverIO — no explicit `driverProvider` needed on macOS:
   ```typescript
   services: [['@wdio/tauri-service', {
     // driverProvider auto-detected as 'embedded' on macOS
   }]]
   ```

   You can also set it explicitly if you prefer:
   ```typescript
   services: [['@wdio/tauri-service', {
     driverProvider: 'embedded',
   }]]
   ```

#### Advantages

- ✅ No external driver needed (no CrabNebula subscription)
- ✅ Works natively on macOS — auto-detected, zero config
- ✅ Same plugin setup works on Windows and Linux too
- ✅ Simpler CI/CD configuration

See [Plugin Setup](./plugin-setup.md) for detailed setup instructions.

---

### CrabNebula

[CrabNebula](https://crabnebula.dev)'s `@crabnebula/tauri-driver` is a cross-platform alternative that works on Windows, Linux, and macOS. It's a fork of the official tauri-driver with added macOS support via a proprietary WebDriver implementation.

#### Platform Support

| Platform | Supported | Requirements |
|----------|-----------|--------------|
| **Windows** | ✅ Yes | `@crabnebula/tauri-driver` |
| **Linux** | ✅ Yes | `@crabnebula/tauri-driver` + `webkit2gtk-driver` |
| **macOS** | ✅ Yes | `@crabnebula/tauri-driver` + `CN_API_KEY` |

> **Note:** `CN_API_KEY` is only required for macOS. Windows and Linux work without an API key.

#### When to Use CrabNebula

- You already have a CrabNebula subscription
- You want a single driver configuration across all platforms
- You need macOS testing without the embedded provider

#### Requirements

1. **@crabnebula/tauri-driver** npm package (all platforms)
2. **@crabnebula/test-runner-backend** npm package (macOS only, for local testing)
3. **CN_API_KEY** environment variable (macOS only)
4. **tauri-plugin-automation** in your Tauri app (macOS only)
5. **webkit2gtk-driver** (Linux only — see Linux section for installation)

#### Setup

1. Install CrabNebula packages:
   ```bash
   npm install -D @crabnebula/tauri-driver
   # For macOS, also install:
   npm install -D @crabnebula/test-runner-backend
   ```

2. **For macOS only** — add the automation plugin to your Tauri app:
   ```bash
   cd src-tauri && cargo add tauri-plugin-automation
   ```

3. **For macOS only** — register the plugin (debug builds only):
   ```rust
   let mut builder = tauri::Builder::default();
   #[cfg(debug_assertions)]
   {
     builder = builder.plugin(tauri_plugin_automation::init());
   }
   ```

4. **For macOS only** — set your API key:
   ```bash
   export CN_API_KEY="your-api-key"
   ```

5. Configure WebdriverIO:
   ```typescript
   services: [['@wdio/tauri-service', {
     driverProvider: 'crabnebula',
   }]]
   ```

See the [CrabNebula Setup Guide](./crabnebula-setup.md) for detailed instructions.

### Alternatives for macOS

If you cannot use the embedded provider or CrabNebula, consider:

1. **Cross-Platform Testing**
   - Develop on macOS, run automated tests on Linux/Windows
   - Perform manual QA on macOS

2. **Web Version**
   - Deploy a web version of your app
   - Test with traditional WebdriverIO setup

### Building on macOS

Build and test Tauri apps on macOS:

```bash
npm install
npm run tauri build
npx wdio run wdio.conf.ts
```

The service auto-detects the embedded provider on macOS. Make sure `tauri-plugin-wdio-webdriver` is installed and registered in your app.

### Example CI Configuration

If you're developing on macOS but testing on Linux:

```yaml
# .github/workflows/test.yml
jobs:
  test-linux:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - uses: dtolnay/rust-toolchain@stable
      - run: npm install
      - run: npm run tauri build
      - run: npm run test:e2e

  build-macos:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - uses: dtolnay/rust-toolchain@stable
      - run: npm install
      - run: npm run tauri build
      # No test step - just build verification
```

## Cross-Platform Tips

### CI/CD Matrix

Test on multiple platforms:

```typescript
// wdio.conf.ts - Example for matrix testing
export const config = {
  onPrepare: async (config, specs) => {
    const platform = process.platform;
    const arch = process.arch;

    console.log(`Testing on ${platform}-${arch}`);

    if (platform === 'win32') {
      config.services = [['@wdio/tauri-service', {
        autoDownloadEdgeDriver: true,
      }]];
    } else if (platform === 'linux') {
      config.services = [['@wdio/tauri-service', {
        // WebKitWebDriver auto-detected
      }]];
    } else if (platform === 'darwin') {
      config.services = [['@wdio/tauri-service', {
        // embedded provider auto-detected on macOS
      }]];
    }
  },
};
```

### Platform-Specific Tests

Skip tests on unsupported platforms:

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

- **Windows** - Fully supported with auto-managed Edge WebDriver ✅
- **Linux** - Fully supported with manual WebKitWebDriver setup ✅
- **macOS** - Fully supported via embedded WebDriver (no external drivers needed) ✅

Choose any platform for automated testing. Use `'embedded'` driver provider for the simplest setup.

## See Also

- [Quick Start](./quick-start.md) for setup instructions
- [Edge WebDriver Windows](./edge-webdriver-windows.md) for Windows-specific details
- [Troubleshooting](./troubleshooting.md) for common issues
- [Tauri Platform-Specific Docs](https://v2.tauri.app/guides/develop/development-cycle/)
