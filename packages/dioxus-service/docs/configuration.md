# Configuration Reference

Complete guide to configuring @wdio/dioxus-service in your WebdriverIO setup.

## Service Configuration

Add the Dioxus service to your `wdio.conf.ts`:

```typescript
export const config = {
  services: [
    ['@wdio/dioxus-service', {
      // Service options go here
      driverProvider: 'embedded',
      captureBackendLogs: true,
      captureFrontendLogs: true,
    }]
  ],
  // ... rest of config
};
```

## Service Options

### `driverProvider` ('external' | 'embedded', optional)

Select which driver provider to use for WebDriver communication.

- `'embedded'`: Use the embedded WebDriver server wired in via `wdio-dioxus-bridge::install()`. No external driver needed. Works on all three platforms.
- `'external'`: Use `wdio-dioxus-driver` + msedgedriver (Windows only in v1). Linux is blocked pending an upstream Dioxus PR; macOS is not supported.

**Platform × Provider matrix:**

| Platform | `'embedded'` | `'external'` |
|----------|-------------|-------------|
| Windows  | ✅ Yes      | ✅ Yes      |
| Linux    | ✅ Yes      | ❌ Blocked in v1 |
| macOS    | ✅ Yes      | ❌ Not supported |

**Default:** `'embedded'`

**Example:**
```typescript
driverProvider: 'embedded'   // Recommended everywhere
driverProvider: 'external'   // Windows only in v1
```

---

### `appBinaryPath` (string, optional)

Path to the compiled Dioxus application binary.

**Example:**
```typescript
appBinaryPath: './target/debug/my_app',    // debug build (bridge active)
appBinaryPath: './target/release/my_app',  // release build (bridge inactive)
```

**Default:** Auto-detected from `dioxus:options.application` capability if not provided.

**Note:** For testing, always use a debug build (`cargo build` without `--release`) so the bridge is compiled in.

---

### `appArgs` (string[], optional)

Command-line arguments to pass to the Dioxus application when launching. Each array element is a separate argument — no shell parsing is applied.

**Example:**
```typescript
appArgs: ['--debug', '--log-level', 'debug']
appArgs: ['--window-size=1920,1080']
```

**Default:** `[]`

---

### `autoInstallDioxusDriver` (boolean, optional)

Automatically install `wdio-dioxus-driver` if not found in PATH. Only relevant when `driverProvider: 'external'`. Requires Rust toolchain (`cargo`).

**Example:**
```typescript
autoInstallDioxusDriver: true
```

**Default:** `false`

---

### `autoDownloadEdgeDriver` (boolean, optional)

Automatically download MSEdgeDriver on Windows if a version mismatch is detected. Only relevant when `driverProvider: 'external'` on Windows.

**Example:**
```typescript
autoDownloadEdgeDriver: true  // Windows + external provider only
```

**Default:** `true`

**Note:** Ignored on Linux and macOS. See [Edge WebDriver (Windows)](./edge-webdriver-windows.md).

---

### `dioxusDriverPort` (number, optional)

Port for `wdio-dioxus-driver` to listen on. Only used when `driverProvider: 'external'`.

**Example:**
```typescript
dioxusDriverPort: 4444
```

**Default:** `4444`

---

### `dioxusDriverPath` (string, optional)

Path to the `wdio-dioxus-driver` executable if not in PATH. Only used when `driverProvider: 'external'`.

**Example:**
```typescript
dioxusDriverPath: '/usr/local/bin/wdio-dioxus-driver'
dioxusDriverPath: 'C:\\tools\\wdio-dioxus-driver.exe'
```

**Default:** Use `wdio-dioxus-driver` from PATH.

---

### `embeddedPort` (number, optional)

Port for the embedded WebDriver server. Only used when `driverProvider: 'embedded'`.

Each worker instance gets a unique port (basePort + workerIndex).

**Example:**
```typescript
embeddedPort: 4445
```

**Default:** `4445`

---

### `statusPollTimeout` (number, optional)

Timeout in milliseconds for the `/status` endpoint poll during embedded WebDriver server startup. Increase this in slow CI environments where a healthy-but-busy server may miss the default deadline.

**Example:**
```typescript
statusPollTimeout: 5000
```

**Default:** `2000`

**Note:** Only applies when `driverProvider: 'embedded'`.

---

### `startTimeout` (number, optional)

Timeout in milliseconds for the Dioxus app to start and become ready.

**Example:**
```typescript
startTimeout: 60000  // 60 seconds
```

**Default:** `60000` for the `'embedded'` provider; `30000` for `'external'`.

---

### `windowLabel` (string, optional)

The default window label to target for Dioxus operations. Controls which webview window `browser.dioxus.execute()` and other Dioxus-specific operations target by default.

**Example:**
```typescript
windowLabel: 'settings'  // Target the settings window by default
```

**Default:** `'main'`

**Note:** Override at runtime with `browser.dioxus.switchWindow(label)`.

---

### `captureBackendLogs` (boolean, optional)

Capture logs from the Dioxus backend (Rust code) and forward them to WebdriverIO's logger.

**Example:**
```typescript
captureBackendLogs: true
```

**Default:** `false`

**Note:** See [Log Forwarding](./log-forwarding.md).

---

### `captureFrontendLogs` (boolean, optional)

Capture console logs from the frontend (JavaScript/TypeScript in the webview).

**Example:**
```typescript
captureFrontendLogs: true
```

**Default:** `false`

**Note:** See [Log Forwarding](./log-forwarding.md).

---

### `backendLogLevel` ('trace' | 'debug' | 'info' | 'warn' | 'error', optional)

Minimum log level to capture from the Rust backend. Logs below this level are ignored.

**Example:**
```typescript
backendLogLevel: 'debug'  // Capture debug and above
```

**Default:** `'info'`

**Note:** Only has effect if `captureBackendLogs: true`.

---

### `frontendLogLevel` ('trace' | 'debug' | 'info' | 'warn' | 'error', optional)

Minimum log level to capture from the frontend webview. Logs below this level are ignored.

**Example:**
```typescript
frontendLogLevel: 'debug'
```

**Default:** `'info'`

**Note:** Only has effect if `captureFrontendLogs: true`.

---

### `env` (Record<string, string>, optional)

Additional environment variables to pass to the Dioxus application process.

**Example:**
```typescript
env: {
  RUST_LOG: 'debug',
  MY_APP_ENV: 'test',
}
```

**Default:** `{}`

---

### `mode` ('native' | 'browser', optional)

Controls how the service connects to your application.

- `'native'` (default) — launches your compiled Dioxus binary via the configured driver provider.
- `'browser'` — skips all driver and binary setup; sets `browserName = 'chrome'`, navigates to `devServerUrl`, and intercepts the invoke API so Dioxus commands can be mocked without a running Rust backend.

**Example:**
```typescript
mode: 'browser'
```

**Default:** `'native'`

> All capabilities in a session must use the same mode. Mixing `'native'` and `'browser'` across capabilities throws a `SevereServiceError` at startup.

See [Browser Mode](./browser-mode.md) for setup, mocking, and limitations.

---

### `devServerUrl` (string, required in browser mode)

URL of the dev server to navigate to when `mode: 'browser'` is set. Validated with `new URL()` at startup.

**Example:**
```typescript
devServerUrl: 'http://localhost:8080'
```

**Default:** `undefined`

**Note:** Only used when `mode: 'browser'`. Has no effect in native mode. See [Browser Mode](./browser-mode.md).

---

### `clearMocks` (boolean, optional)

If `true`, all mock call history is cleared before each test. Equivalent to calling `browser.dioxus.clearAllMocks()` in a `beforeEach`.

**Default:** `false`

---

### `clearMocksPrefix` (string, optional)

If set, only mocks whose command name starts with this prefix are cleared. Only used when `clearMocks: true`.

**Default:** `undefined`

---

### `resetMocks` (boolean, optional)

If `true`, all mocks are reset (implementation + history) before each test.

**Default:** `false`

---

### `resetMocksPrefix` (string, optional)

If set, only mocks whose command name starts with this prefix are reset. Only used when `resetMocks: true`.

**Default:** `undefined`

---

### `restoreMocks` (boolean, optional)

If `true`, all mocks are restored to their original implementations before each test.

**Default:** `false`

---

### `restoreMocksPrefix` (string, optional)

If set, only mocks whose command name starts with this prefix are restored. Only used when `restoreMocks: true`.

**Default:** `undefined`

---

## Capabilities Configuration

Configure Dioxus-specific capabilities in your `capabilities` array:

### Basic Configuration

```typescript
capabilities: [{
  browserName: 'dioxus',
  'dioxus:options': {
    application: './target/debug/my_app'
  }
}]
```

### Full Capability Configuration

```typescript
capabilities: [{
  browserName: 'dioxus',
  'dioxus:options': {
    application: './target/debug/my_app',
    args: ['--debug'],
    webviewOptions: {
      width: 1280,
      height: 800,
    },
  },
  'wdio:dioxusServiceOptions': {
    windowLabel: 'main',
    captureBackendLogs: true,
  },
}]
```

### `dioxus:options` Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `application` | string | Yes | Path to the Dioxus app binary |
| `args` | string[] | No | Arguments passed to the app |
| `webviewOptions.width` | number | No | Initial window width in pixels |
| `webviewOptions.height` | number | No | Initial window height in pixels |

### Multiremote Configuration

```typescript
capabilities: {
  app1: {
    browserName: 'dioxus',
    'dioxus:options': {
      application: './target/debug/my_app'
    }
  },
  app2: {
    browserName: 'dioxus',
    'dioxus:options': {
      application: './target/debug/my_app'
    }
  }
}
```

## Complete Configuration Example

```typescript
// wdio.conf.ts
export const config = {
  runner: 'local',
  specs: ['./test/specs/**/*.spec.ts'],
  maxInstances: 1,

  services: [
    ['@wdio/dioxus-service', {
      driverProvider: 'embedded',
      appBinaryPath: './target/debug/my_app',
      appArgs: [],
      embeddedPort: 4445,
      startTimeout: 60000,
      statusPollTimeout: 2000,
      captureBackendLogs: true,
      captureFrontendLogs: true,
      backendLogLevel: 'debug',
      frontendLogLevel: 'debug',
      windowLabel: 'main',
      clearMocks: false,
      resetMocks: false,
      restoreMocks: false,
    }]
  ],

  capabilities: [{
    browserName: 'dioxus',
    'dioxus:options': {
      application: './target/debug/my_app',
    },
  }],

  logLevel: 'info',
  bail: 0,
  waitforTimeout: 10000,
  connectionRetryTimeout: 90000,
  connectionRetryCount: 3,

  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },

  reporters: ['spec'],
};
```

## Platform-Specific Configuration

### Windows (`'embedded'` — recommended)

```typescript
services: [
  ['@wdio/dioxus-service', {
    driverProvider: 'embedded',
    appBinaryPath: './target/debug/my_app.exe',
  }]
]
```

### Windows (`'external'`)

```typescript
services: [
  ['@wdio/dioxus-service', {
    driverProvider: 'external',
    autoInstallDioxusDriver: true,
    autoDownloadEdgeDriver: true,
    appBinaryPath: './target/debug/my_app.exe',
  }]
]
```

### Linux (embedded only)

```typescript
services: [
  ['@wdio/dioxus-service', {
    driverProvider: 'embedded',  // Only supported option on Linux
    appBinaryPath: './target/debug/my_app',
  }]
]
```

### macOS (embedded only)

```typescript
services: [
  ['@wdio/dioxus-service', {
    driverProvider: 'embedded',  // Only supported option on macOS
    appBinaryPath: './target/debug/my_app',
  }]
]
```

## Finding Your Binary Path

### Debug Build (for testing)

```bash
cargo build
```

Binary locations:
- Windows: `target\debug\my_app.exe`
- Linux/macOS: `target/debug/my_app`

### Release Build (for production — bridge compiled out)

```bash
cargo build --release
```

Binary locations:
- Windows: `target\release\my_app.exe`
- Linux/macOS: `target/release/my_app`

**Always use a debug build for testing** so the bridge code is present.

## See Also

- [Quick Start](./quick-start.md) for getting started
- [Bridge Setup](./plugin-setup.md) for bridge configuration
- [API Reference](./api-reference.md) for available functions
- [Log Forwarding](./log-forwarding.md) for logging configuration
- [Platform Support](./platform-support.md) for per-platform details
