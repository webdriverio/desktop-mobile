# Configuration Reference

Complete guide to configuring @wdio/tauri-service in your WebdriverIO setup.

## Service Configuration

Add the Tauri service to your `wdio.conf.ts`:

```typescript
export const config = {
  services: [
    ['@wdio/tauri-service', {
      // Service options go here
      autoInstallTauriDriver: true,
      autoDownloadEdgeDriver: true,
      captureBackendLogs: true,
      captureFrontendLogs: true,
    }]
  ],
  // ... rest of config
};
```

## Service Options

### `appBinaryPath` (string, optional)

Path to the compiled Tauri application binary (executable).

**Example:**
```typescript
appBinaryPath: './src-tauri/target/release/my-app.exe',  // Windows
appBinaryPath: './src-tauri/target/release/my-app',     // Linux
```

**Default:** Auto-detected from capabilities if not provided

**Note:** Path should be absolute or relative to the WebdriverIO config directory.

---

### `appArgs` (string[], optional)

Command-line arguments to pass to the Tauri application when launching. Each array element is passed as a separate argument — no shell parsing is applied.

**Example:**
```typescript
appArgs: ['--debug', '--log-level', 'debug']

// For key=value style arguments, use either form:
appArgs: ['--window-size', '1920,1080']   // Two separate elements
appArgs: ['--window-size=1920,1080']       // Single element with equals
```

**Default:** `[]`

---

### `autoInstallTauriDriver` (boolean, optional)

Automatically install `tauri-driver` if not found in PATH.

**Requirements:**
- Rust toolchain must be installed (`cargo`)
- First installation will take a few minutes

**Example:**
```typescript
autoInstallTauriDriver: true
```

**Default:** `false`

**Note:** Disable if you have `tauri-driver` installed manually or globally.

---

### `autoDownloadEdgeDriver` (boolean, optional)

Automatically download MSEdgeDriver on Windows if version mismatch detected.

**Example:**
```typescript
autoDownloadEdgeDriver: true  // Windows only
```

**Default:** `true`

**Note:** Windows only, ignored on Linux/macOS. See [Edge WebDriver Windows](./edge-webdriver-windows.md).

---

### `tauriDriverPort` (number, optional)

Port for tauri-driver to listen on. Each worker process gets a unique port (port + worker index).

**Example:**
```typescript
tauriDriverPort: 4444
```

**Default:** `4444`

**Note:** Increment for multiremote to avoid port conflicts.

---

### `tauriDriverPath` (string, optional)

Path to the `tauri-driver` executable if not in PATH.

**Example:**
```typescript
tauriDriverPath: '/usr/local/bin/tauri-driver'  // Linux/macOS
tauriDriverPath: 'C:\\tools\\tauri-driver.exe'  // Windows
```

**Default:** Use `tauri-driver` from PATH

---

### `logLevel` ('trace' | 'debug' | 'info' | 'warn' | 'error', optional)

Log level for tauri-driver output.

**Example:**
```typescript
logLevel: 'debug'  // More verbose
```

**Default:** `'info'`

---

### `windowLabel` (string, optional)

The default window label to target for Tauri operations. This controls which webview window `browser.tauri.execute()` and other Tauri-specific operations target by default.

**Example:**
```typescript
windowLabel: 'settings'  // Target the settings window by default
```

**Default:** `'main'`

**Note:** 
- Each browser instance (including multiremote) can have its own default windowLabel
- Override at runtime with `browser.tauri.switchWindow(label)`
- Per-call override with `browser.tauri.execute(fn, withExecuteOptions({ windowLabel: 'x' }))` is supported

---

### `commandTimeout` (number, optional)

Timeout in milliseconds for individual command execution.

**Example:**
```typescript
commandTimeout: 60000  // 60 seconds
```

**Default:** `30000` (30 seconds)

---

### `startTimeout` (number, optional)

Timeout in milliseconds for the Tauri app to start and become ready.

**Example:**
```typescript
startTimeout: 60000  // 60 seconds
```

**Default:** `30000` for the `'official'` and `'crabnebula'` providers, `60000` for the `'embedded'` provider (the embedded WebDriver server takes longer to come up, especially on Windows CI).

---

### `captureBackendLogs` (boolean, optional)

Capture logs from the Tauri backend (Rust code).

**Example:**
```typescript
captureBackendLogs: true
```

**Default:** `false`

**Note:** When enabled, logs appear in WebdriverIO reports. See [Log Forwarding](./log-forwarding.md).

---

### `captureFrontendLogs` (boolean, optional)

Capture console logs from the frontend (JavaScript/TypeScript).

**Example:**
```typescript
captureFrontendLogs: true
```

**Default:** `false`

**Note:** When enabled, console.log() calls appear in WebdriverIO reports. See [Log Forwarding](./log-forwarding.md).

---

### `backendLogLevel` ('trace' | 'debug' | 'info' | 'warn' | 'error', optional)

Minimum log level to capture from backend. Logs below this level are ignored.

**Example:**
```typescript
backendLogLevel: 'debug'  // Capture debug and above
```

**Default:** `'info'`

**Note:** Only has effect if `captureBackendLogs: true`.

---

### `frontendLogLevel` ('trace' | 'debug' | 'info' | 'warn' | 'error', optional)

Minimum log level to capture from frontend. Logs below this level are ignored.

**Example:**
```typescript
frontendLogLevel: 'debug'
```

**Default:** `'info'`

**Note:** Only has effect if `captureFrontendLogs: true`.

---

### `logDir` (string, optional)

Directory to store logs from the Tauri service (for standalone mode).

**Example:**
```typescript
logDir: './test-logs'
```

**Default:** Logs to stdout/stderr

---

### `statusPollTimeout` (number, optional)

Timeout in milliseconds for the `/status` endpoint poll during embedded WebDriver server startup. Increase this in slow CI environments (e.g. containerised Windows runners) where a healthy-but-busy server may miss the default deadline and trigger a false-positive restart.

**Example:**
```typescript
statusPollTimeout: 5000
```

**Default:** `2000`

**Note:** Only applies when `driverProvider: 'embedded'`.

---

### `devServerUrl` (string, required in browser mode)

URL of the Vite (or other) dev server to navigate to when `mode: 'browser'` is set. Validated with `new URL()` at startup; throws a `SevereServiceError` if missing or malformed when browser mode is active.

**Example:**
```typescript
devServerUrl: 'http://localhost:1420'  // Tauri Vite default
```

**Default:** `undefined`

**Note:** Only used when `mode: 'browser'`. Has no effect in native mode. See [Browser Mode](./browser-mode.md).

---

### `mode` ('native' | 'browser', optional)

Controls how the service connects to your application.

- `'native'` (default) — launches your compiled Tauri binary via tauri-driver and WebKitWebDriver/msedgedriver.
- `'browser'` — skips all driver and binary setup; sets `browserName = 'chrome'`, navigates to `devServerUrl`, and intercepts `window.__TAURI_INTERNALS__.invoke` so Tauri commands can be mocked without a running Rust backend.

**Example:**
```typescript
mode: 'browser'
```

**Default:** `'native'`

> **Note:** All capabilities in a session must use the same mode. Mixing `'native'` and `'browser'` across capabilities throws a `SevereServiceError` at startup.

See [Browser Mode](./browser-mode.md) for setup, mocking, and limitations.

---

### `clearMocks` (boolean, optional)

If `true`, all mock call history is cleared before each test. Equivalent to calling `browser.tauri.clearAllMocks()` in a `beforeEach`.

**Example:**
```typescript
clearMocks: true
```

**Default:** `false`

---

### `clearMocksPrefix` (string, optional)

If set, only mocks whose command name starts with this prefix are cleared. Only used when `clearMocks: true`.

**Example:**
```typescript
clearMocks: true,
clearMocksPrefix: 'clipboard'  // Only clears clipboard.* mocks
```

**Default:** `undefined`

---

### `resetMocks` (boolean, optional)

If `true`, all mocks are reset (implementation + history) before each test. Equivalent to `browser.tauri.resetAllMocks()` in a `beforeEach`.

**Example:**
```typescript
resetMocks: true
```

**Default:** `false`

---

### `resetMocksPrefix` (string, optional)

If set, only mocks whose command name starts with this prefix are reset. Only used when `resetMocks: true`.

**Default:** `undefined`

---

### `restoreMocks` (boolean, optional)

If `true`, all mocks are restored to their original implementations before each test. Equivalent to `browser.tauri.restoreAllMocks()` in a `beforeEach`.

**Example:**
```typescript
restoreMocks: true
```

**Default:** `false`

---

### `restoreMocksPrefix` (string, optional)

If set, only mocks whose command name starts with this prefix are restored. Only used when `restoreMocks: true`.

**Default:** `undefined`

---

### `driverProvider` ('official' | 'crabnebula' | 'embedded', optional)

Select which driver provider to use for WebDriver communication.

- `'embedded'`: Use embedded WebDriver server via tauri-plugin-wdio-webdriver (no external driver needed, works on all platforms)
- `'official'`: Use the cargo-installed tauri-driver (supports Windows/Linux)
- `'crabnebula'`: Use @crabnebula/tauri-driver from npm (supports Windows/Linux/macOS; CN_API_KEY required for macOS only)

**Auto-detection (no explicit config needed):**

The service automatically selects `'embedded'` when either of the following signals is present:
- `TAURI_WEBDRIVER_PORT` environment variable is set (you've configured the plugin's port)
- Running on macOS (WKWebView requires the embedded approach)

If neither signal is present on Windows or Linux, the service throws an immediate error with instructions.

**Example:**
```typescript
// Auto-detected on macOS, or when TAURI_WEBDRIVER_PORT is set — no config needed
// driverProvider: 'embedded'  (set this explicitly to be unambiguous)

// Use CrabNebula — all platforms; CN_API_KEY required for macOS
driverProvider: 'crabnebula'

// Use official tauri-driver — opt out of embedded provider
driverProvider: 'official'
```

**Default:** Auto-detected (see above). Set explicitly to override.

**Note:** Install `tauri-plugin-wdio-webdriver` in your Tauri app to use the embedded provider. See [Plugin Setup](./plugin-setup.md) for details.

---

### Choosing a Driver Provider

| Provider | Platform Support | External driver required | Notes |
|----------|-----------------|--------------------------|-------|
| `'embedded'` | Windows, Linux, macOS | No | No external deps; auto-detected on macOS or via `TAURI_WEBDRIVER_PORT` |
| `'official'` | Windows, Linux | Yes (tauri-driver + platform driver) | Explicit opt-in; cargo-installed |
| `'crabnebula'` | Windows, Linux, macOS | Yes (platform driver; CN_API_KEY for macOS) | Fork of official driver; good fit if already on CrabNebula platform |

**Recommendation:**

- **`'embedded'`** — simplest setup: no external driver installation, works on all three platforms
- **`'crabnebula'`** — best if you are already using CrabNebula Cloud or want a single driver config across all platforms; macOS testing requires a CrabNebula subscription
- **`'official'`** — explicit opt-in for Windows/Linux if you have `tauri-driver` already installed

---

### `embeddedPort` (number, optional)

Port for the embedded WebDriver server. Only used when `driverProvider: 'embedded'`.

- The service spawns your Tauri app with this port
- Each worker instance gets a unique port (basePort + workerIndex)
- Can also be set via the `TAURI_WEBDRIVER_PORT` or `WDIO_EMBEDDED_PORT` environment variable. Setting either env var also serves as the auto-detection signal that opts you into the embedded provider on Windows/Linux.

**Example:**
```typescript
embeddedPort: 4445
```

**Default:** `4445`

**Note:** Port must be available. The service will fail if the port is in use.

---

### `crabnebulaDriverPath` (string, optional)

Path to the @crabnebula/tauri-driver executable. Only used when `driverProvider: 'crabnebula'`.

**Example:**
```typescript
crabnebulaDriverPath: './node_modules/.bin/tauri-driver'
```

**Default:** Auto-detected from node_modules

---

### `crabnebulaManageBackend` (boolean, optional)

Auto-manage the test-runner-backend process (macOS only). When enabled, the service will automatically start and stop the backend.

**Example:**
```typescript
crabnebulaManageBackend: true
```

**Default:** `true` when using CrabNebula on macOS

---

### `crabnebulaBackendPort` (number, optional)

Port for the test-runner-backend to listen on (macOS only).

**Example:**
```typescript
crabnebulaBackendPort: 3000
```

**Default:** `3000`

---

## Capabilities Configuration

Configure Tauri-specific capabilities in your `capabilities` array:

### Basic Configuration

```typescript
capabilities: [{
  browserName: 'tauri',
  'tauri:options': {
    application: './src-tauri/target/release/my-app.exe'
  }
}]
```

> `browserName` accepts either `'tauri'` (preferred) or `'wry'` (the underlying webview library). Both are treated identically by the service.

### Full Configuration

```typescript
capabilities: [{
  browserName: 'tauri',
  'tauri:options': {
    application: './src-tauri/target/release/my-app.exe',
    args: ['--debug']
  },
  // Optional: override service settings per capability
  // tauriDriverPort: 4445,
}]
```

### Multiremote Configuration

Run multiple instances of the app:

```typescript
capabilities: {
  app1: {
    browserName: 'tauri',
    'tauri:options': {
      application: './src-tauri/target/release/my-app.exe'
    }
  },
  app2: {
    browserName: 'tauri',
    'tauri:options': {
      application: './src-tauri/target/release/my-app.exe'
    }
  }
}
```

Or as array:

```typescript
capabilities: [
  {
    browserName: 'tauri',
    'tauri:options': {
      application: './src-tauri/target/release/my-app.exe'
    }
  },
  {
    browserName: 'tauri',
    'tauri:options': {
      application: './src-tauri/target/release/my-app.exe'
    }
  }
]
```

## Complete Configuration Example

```typescript
// wdio.conf.ts
export const config = {
  runner: 'local',

  // Specs
  specs: ['./test/specs/**/*.spec.ts'],
  exclude: ['./test/specs/integration/**/*.spec.ts'],

  // Parallelization
  maxInstances: 1,
  maxInstancesPerCapability: 1,

  // Tauri Service
  services: [
    ['@wdio/tauri-service', {
      appBinaryPath: './src-tauri/target/release/my-app.exe',
      appArgs: ['--debug'],
      autoInstallTauriDriver: true,
      autoDownloadEdgeDriver: true,  // Windows only
      tauriDriverPort: 4444,
      logLevel: 'info',
      commandTimeout: 30000,
      startTimeout: 30000,
      captureBackendLogs: true,
      captureFrontendLogs: true,
      backendLogLevel: 'debug',
      frontendLogLevel: 'debug',
    }]
  ],

  // Capabilities
  capabilities: [{
    browserName: 'tauri',
    'tauri:options': {
      application: './src-tauri/target/release/my-app.exe',
      args: ['--debug']
    }
  }],

  // Connection settings
  logLevel: 'info',
  bail: 0,
  baseUrl: 'http://localhost:4444',
  waitforTimeout: 10000,
  connectionRetryTimeout: 90000,
  connectionRetryCount: 3,

  // Framework
  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000
  },

  // Reporters
  reporters: ['spec'],

  // Hooks
  onPrepare: async (config, capabilities) => {
    console.log('Starting test run...');
  },

  onComplete: async (exitCode, config, capabilities, results) => {
    console.log('Test run completed');
  }
};
```

## Platform-Specific Configuration

### Windows Configuration

Enable auto Edge WebDriver management:

```typescript
services: [
  ['@wdio/tauri-service', {
    appBinaryPath: './src-tauri/target/release/my-app.exe',
    autoDownloadEdgeDriver: true,  // Auto-download on version mismatch
  }]
]
```

### Linux Configuration

WebKitWebDriver is auto-detected:

```typescript
services: [
  ['@wdio/tauri-service', {
    appBinaryPath: './src-tauri/target/release/my-app',
    autoInstallTauriDriver: true,
  }]
]
```

### Headless Configuration (Linux)

Run tests without a display server:

```typescript
services: [
  ['@wdio/tauri-service', {
    appBinaryPath: './src-tauri/target/release/my-app',
    // Xvfb is auto-detected if available (WebdriverIO 9.19.1+)
  }]
]
```

## Finding Your appBinaryPath

### Windows

Build your app:
```bash
cd src-tauri
cargo build --release
```

Binary is at:
```
./src-tauri/target/release/my-app.exe
```

(Replace `my-app` with your app name from `Cargo.toml`)

### Linux

Build your app:
```bash
cd src-tauri
cargo build --release
```

Binary is at:
```
./src-tauri/target/release/my-app
```

(Replace `my-app` with your app name)

### Verify Binary Exists

```bash
# Windows
if exist "src-tauri\target\release\my-app.exe" echo "Binary found"

# Linux/macOS
ls -la src-tauri/target/release/my-app
```

## Configuration Validation

Check your configuration with:

```bash
# Verify service can be loaded
npx wdio config

# Run with verbose logging
npx wdio run wdio.conf.ts --logLevel debug
```

## Common Configuration Patterns

### Development Configuration

```typescript
export const config = {
  // ... other settings
  services: [
    ['@wdio/tauri-service', {
      appBinaryPath: './src-tauri/target/release/my-app.exe',
      autoInstallTauriDriver: true,
      autoDownloadEdgeDriver: true,
      captureBackendLogs: true,
      captureFrontendLogs: true,
      backendLogLevel: 'debug',
      frontendLogLevel: 'debug',
      logLevel: 'debug',
    }]
  ],
};
```

### CI/CD Configuration

```typescript
export const config = {
  // ... other settings
  services: [
    ['@wdio/tauri-service', {
      appBinaryPath: process.env.APP_BINARY || './src-tauri/target/release/my-app.exe',
      autoInstallTauriDriver: true,
      autoDownloadEdgeDriver: true,
      captureBackendLogs: true,
      captureFrontendLogs: true,
      logLevel: 'info',
    }]
  ],
};
```

### Production-Like Configuration

```typescript
export const config = {
  // ... other settings
  services: [
    ['@wdio/tauri-service', {
      appBinaryPath: './src-tauri/target/release/my-app.exe',
      autoInstallTauriDriver: false,  // Pre-installed
      autoDownloadEdgeDriver: false,  // Pre-downloaded
      captureBackendLogs: false,
      captureFrontendLogs: false,
      logLevel: 'warn',
    }]
  ],
};
```

## Troubleshooting Configuration Issues

**"Cannot find appBinaryPath"**

1. Verify path exists:
   ```bash
   ls -la src-tauri/target/release/my-app*
   ```

2. Build the app first:
   ```bash
   cd src-tauri && cargo build --release
   ```

3. Use absolute path in config:
   ```typescript
   appBinaryPath: path.resolve('./src-tauri/target/release/my-app.exe')
   ```

**"Service not found"**

Ensure service is installed:
```bash
npm list @wdio/tauri-service
```

If missing:
```bash
npm install --save-dev @wdio/tauri-service
```

**"Port already in use"**

Change the tauri-driver port:
```typescript
tauriDriverPort: 4445  // Instead of 4444
```

Or enable multiremote with auto-port assignment:
```typescript
maxInstances: 3  // Each gets unique port
```

## See Also

- [Quick Start](./quick-start.md) for getting started
- [Plugin Setup](./plugin-setup.md) for Tauri plugin configuration
- [API Reference](./api-reference.md) for available functions
- [Log Forwarding](./log-forwarding.md) for logging configuration
