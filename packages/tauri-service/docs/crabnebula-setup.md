# CrabNebula Setup Guide

This guide walks you through setting up CrabNebula's tauri-driver for cross-platform Tauri testing.

## Overview

[CrabNebula](https://crabnebula.dev)'s `@crabnebula/tauri-driver` is a fork of the official tauri-driver that works on **Windows, Linux, and macOS**. It provides a cross-platform alternative to the official driver, with the added benefit of macOS support.

### Platform Support

| Platform | Supported | Requirements |
|----------|-----------|--------------|
| **Windows** | ✅ Yes | `@crabnebula/tauri-driver` |
| **Linux** | ✅ Yes | `@crabnebula/tauri-driver` + `webkit2gtk-driver` |
| **macOS** | ✅ Yes | `@crabnebula/tauri-driver` + `CN_API_KEY` |

### Key Points

- **CN_API_KEY is only required for macOS** — Windows and Linux work without an API key
- **tauri-plugin-automation is only needed for macOS** — not required on Windows or Linux
- **webkit2gtk-driver is required for Linux** — same as the official driver

## When to Use CrabNebula

Choose CrabNebula when:

- You want a single driver configuration across all platforms (Windows, Linux, macOS)
- You already have a CrabNebula subscription
- You need macOS testing but cannot use the embedded provider (`tauri-plugin-wdio-webdriver`)

For most users, the **embedded provider** (via `tauri-plugin-wdio-webdriver`) is the recommended choice for macOS testing — it's free, native, and requires no external services.

## Prerequisites

### All Platforms

1. **Node.js 18+** and **Rust toolchain** installed
2. A **Tauri v2 application**

### Linux Only

- **webkit2gtk-driver** installed (see [Linux Installation](#linux-installation))

### macOS Only

1. **CrabNebula account** with API key (contact [CrabNebula](https://crabnebula.dev) for access)
2. **tauri-plugin-automation** installed in your Tauri app

## Installation

### Step 1: Install CrabNebula Packages

Install the npm packages as dev dependencies:

```bash
# All platforms
npm install -D @crabnebula/tauri-driver

# macOS only (for local testing)
npm install -D @crabnebula/test-runner-backend
```

Or with pnpm:

```bash
pnpm add -D @crabnebula/tauri-driver
# macOS only:
pnpm add -D @crabnebula/test-runner-backend
```

### Step 2: Linux Installation

On Linux, you need WebKitWebDriver (same as the official driver):

```bash
# Debian/Ubuntu
sudo apt-get update
sudo apt-get install -y webkit2gtk-driver

# Fedora
sudo dnf install -y webkit2gtk-driver

# Arch Linux
sudo pacman -S webkit2gtk-4.1
```

Verify installation:

```bash
which WebKitWebDriver
# Should output: /usr/bin/WebKitWebDriver
```

### Step 3: macOS Setup (Optional)

For macOS testing, you need the automation plugin and API key:

#### Add Automation Plugin

1. Navigate to your Tauri source directory:
   ```bash
   cd src-tauri
   ```

2. Add the plugin:
   ```bash
   cargo add tauri-plugin-automation
   ```

3. Register the plugin in your Rust code. **Important**: Only include this in debug builds:
   ```rust
   // src-tauri/src/lib.rs or main.rs
   
   let mut builder = tauri::Builder::default();
   
   // Only enable automation in debug builds
   #[cfg(debug_assertions)]
   {
     builder = builder.plugin(tauri_plugin_automation::init());
   }
   
   builder
     .run(tauri::generate_context!())
     .expect("error while running tauri application");
   ```

   > ⚠️ **Warning**: Never include the automation plugin in release builds, as it could allow external control of your application.

#### Set API Key

Set your CrabNebula API key as an environment variable:

```bash
export CN_API_KEY="your-api-key-here"
```

For CI/CD, add this as a secret:

**GitHub Actions:**
```yaml
env:
  CN_API_KEY: ${{ secrets.CN_API_KEY }}
```

### Step 4: Configure WebdriverIO

Update your `wdio.conf.ts` to use CrabNebula:

```typescript
export const config = {
  services: [
    ['@wdio/tauri-service', {
      driverProvider: 'crabnebula',
      // macOS only - auto-manage the test-runner-backend (default: true)
      crabnebulaManageBackend: true,
      // macOS only - backend port (default: 3000)
      crabnebulaBackendPort: 3000,
    }]
  ],
  
  capabilities: [{
    browserName: 'tauri',
    'tauri:options': {
      // Path to your binary
      application: './src-tauri/target/release/your-app-name',
    }
  }],
  
  // ... rest of your config
};
```

### Step 5: Build and Run

Build your Tauri app:

```bash
# Debug build (required for macOS automation plugin)
npm run tauri build -- --debug

# Or with cargo directly
cd src-tauri && cargo build
```

Run your tests:

```bash
npm run wdio
```

## Platform-Specific Notes

### Windows

- No additional setup required beyond installing `@crabnebula/tauri-driver`
- Edge WebDriver is auto-managed by the service

### Linux

- Requires `webkit2gtk-driver` (see installation above)
- For headless CI, use Xvfb:
  ```bash
  xvfb-run -a npm run wdio
  ```

### macOS

- Requires `CN_API_KEY` environment variable
- Requires `tauri-plugin-automation` in debug builds
- Requires `@crabnebula/test-runner-backend` for local testing
- The service auto-starts/stops the test-runner-backend

## CI/CD Configuration

### GitHub Actions Example

```yaml
name: E2E Tests

on: [push, pull_request]

jobs:
  test-linux:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - uses: dtolnay/rust-toolchain@stable
      
      - name: Install WebKitWebDriver
        run: sudo apt-get install -y webkit2gtk-driver
      
      - name: Install dependencies
        run: npm install
      
      - name: Build Tauri app
        run: npm run tauri build -- --debug
      
      - name: Run E2E tests
        run: xvfb-run -a npm run test:e2e
        env:
          DRIVER_PROVIDER: crabnebula

  test-macos:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - uses: dtolnay/rust-toolchain@stable
      
      - name: Install dependencies
        run: npm install
      
      - name: Build Tauri app
        run: npm run tauri build -- --debug
      
      - name: Run E2E tests
        env:
          CN_API_KEY: ${{ secrets.CN_API_KEY }}
          DRIVER_PROVIDER: crabnebula
        run: npm run test:e2e

  test-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - uses: dtolnay/rust-toolchain@stable
      
      - name: Install dependencies
        run: npm install
      
      - name: Build Tauri app
        run: npm run tauri build -- --debug
      
      - name: Run E2E tests
        env:
          DRIVER_PROVIDER: crabnebula
        run: npm run test:e2e
```

### Conditional Testing (No API Key)

If you don't have a CN_API_KEY in certain environments (e.g., PRs from forks):

```yaml
- name: Run E2E tests (macOS)
  if: env.CN_API_KEY != ''
  env:
    CN_API_KEY: ${{ secrets.CN_API_KEY }}
  run: npm run test:e2e

- name: Skip E2E tests (no API key)
  if: env.CN_API_KEY == ''
  run: echo "Skipping macOS tests - no CN_API_KEY available"
```

## Troubleshooting

### "CN_API_KEY is not set" (macOS)

**Solution**: Ensure the environment variable is set:
```bash
echo $CN_API_KEY  # Should show your API key
```

If empty, set it:
```bash
export CN_API_KEY="your-api-key"
```

### "@crabnebula/tauri-driver not found"

**Solution**: Install the package:
```bash
npm install -D @crabnebula/tauri-driver
```

### "tauri-plugin-automation not found" (macOS)

**Solution**: Add the plugin to your Tauri app:
```bash
cd src-tauri && cargo add tauri-plugin-automation
```

Then ensure it's registered in your Rust code with the `#[cfg(debug_assertions)]` guard.

### "WebKitWebDriver not found" (Linux)

**Solution**: Install WebKitWebDriver:
```bash
# Debian/Ubuntu
sudo apt-get install -y webkit2gtk-driver

# Fedora
sudo dnf install -y webkit2gtk-driver

# Arch Linux
sudo pacman -S webkit2gtk-4.1
```

### "test-runner-backend exited with code X" (macOS)

**Possible causes**:
- Invalid or expired CN_API_KEY
- Port 3000 already in use
- macOS security restrictions

**Solutions**:
1. Verify your API key is valid
2. Change the backend port:
   ```typescript
   crabnebulaBackendPort: 3001
   ```
3. Check System Preferences > Security & Privacy for any blocked applications

### Tests work on Windows/Linux but not macOS

**Checklist**:
- [ ] CN_API_KEY is set and valid
- [ ] tauri-plugin-automation is in Cargo.toml
- [ ] Plugin is registered with `#[cfg(debug_assertions)]`
- [ ] App is built in debug mode (target/debug/)
- [ ] @crabnebula/tauri-driver is installed
- [ ] @crabnebula/test-runner-backend is installed

## Advanced Configuration

### Custom Backend Port (macOS)

If port 3000 is already in use:

```typescript
services: [['@wdio/tauri-service', {
  driverProvider: 'crabnebula',
  crabnebulaBackendPort: 3001,
}]]
```

### Manual Backend Management (macOS)

If you prefer to manage the backend yourself:

```typescript
services: [['@wdio/tauri-service', {
  driverProvider: 'crabnebula',
  crabnebulaManageBackend: false,  // You'll start/stop it manually
}]]
```

Then in your test setup:
```bash
# Terminal 1: Start backend
npx test-runner-backend

# Terminal 2: Run tests
export REMOTE_WEBDRIVER_URL=http://127.0.0.1:3000
npm run wdio
```

### Custom Driver Path

If the driver is not in node_modules/.bin:

```typescript
services: [['@wdio/tauri-service', {
  driverProvider: 'crabnebula',
  crabnebulaDriverPath: '/custom/path/to/tauri-driver',
}]]
```

## Migration from Official Driver

If you're already using the official tauri-driver on Windows/Linux:

1. Keep your existing configuration for Windows/Linux
2. Add CrabNebula packages as dev dependencies
3. **For macOS only**: Add the automation plugin to your Tauri app
4. **For macOS only**: Set CN_API_KEY in your environment
5. Update your WebdriverIO config:

```typescript
const isMacOS = process.platform === 'darwin';

export const config = {
  services: [['@wdio/tauri-service', {
    driverProvider: 'crabnebula',  // Works on all platforms
    // On macOS, also needs CN_API_KEY and automation plugin
  }]]
};
```

Or conditionally use different external drivers — CrabNebula on macOS, the standard
`external` tauri-driver where you already have it. (If you'd rather not run an external
driver at all, `embedded` works on every platform and is the simplest default.)

```typescript
const driverProvider = process.env.DRIVER_PROVIDER ||
  (process.platform === 'darwin' ? 'crabnebula' : 'external');

export const config = {
  services: [['@wdio/tauri-service', {
    driverProvider,
  }]]
};
```

## Comparison: Driver Providers

| Feature | `external` | `crabnebula` | `embedded` |
|---------|-----------|--------------|------------|
| Windows | ✅ | ✅ | ✅ |
| Linux | ✅ | ✅ | ✅ |
| macOS | ❌ | ✅ | ✅ |
| External driver | Yes | Yes | No |
| API key | No | macOS only | No |
| Plugin required | No | macOS only | Yes |
| Cost | Free | Subscription | Free |

**Recommendation**: Use `embedded` for the simplest cross-platform setup. Use `crabnebula` if you already have a subscription or need specific features.

## Getting Help

- **CrabNebula Documentation**: https://docs.crabnebula.dev/tauri/webdriver/
- **CrabNebula Support**: Contact via their website for API key and support
- **WebdriverIO Issues**: Report integration issues to the [desktop-mobile repository](https://github.com/webdriverio/desktop-mobile/issues)
- **Troubleshooting Guide**: See [troubleshooting.md](./troubleshooting.md) for common issues
