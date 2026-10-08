# Configuration Reference

Complete guide to configuring @wdio/dioxus-service in your WebdriverIO setup.

## Service Configuration

Add the Dioxus service to your `wdio.conf.ts`:

```typescript
export const config = {
  services: [
    ['@wdio/dioxus-service', {
      // Service options go here
      captureBackendLogs: true,
      captureFrontendLogs: true,
    }]
  ],
  // ... rest of config
};
```

## Service Options

### `appBinaryPath` (string, optional)

Path to the compiled Dioxus application binary.

**Example:**
```typescript
appBinaryPath: './target/dx/my_app/debug/linux/app/my_app',    // debug build (driver and bridge active)
appBinaryPath: './target/dx/my_app/release/linux/app/my_app',  // release build (driver and bridge inactive)
```

**Default:** Auto-detected from `dioxus:options.application` capability if not provided.

**Note:** For testing, always use a debug build (`dx build --desktop` without `--release`) so the driver and bridge are compiled in. See [Finding Your Binary Path](#finding-your-binary-path) for the location on each platform. Other examples on this page use `./target/debug/my_app` for brevity; that's where `cargo build` puts the binary, which only works for apps that don't load files with `asset!()`.

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

### `embeddedPort` (number, optional)

Port for the embedded WebDriver server.

Each worker instance gets a unique port (basePort + workerIndex).

**Example:**
```typescript
embeddedPort: 4445
```

**Default:** `4444`

---

### `statusPollTimeout` (number, optional)

Timeout in milliseconds for the `/status` endpoint poll during embedded WebDriver server startup. Increase this in slow CI environments where a healthy-but-busy server may miss the default deadline.

**Example:**
```typescript
statusPollTimeout: 5000
```

**Default:** `2000`

---

### `startTimeout` (number, optional)

Timeout in milliseconds for the Dioxus app to start and become ready.

**Example:**
```typescript
startTimeout: 60000  // 60 seconds
```

**Default:** `60000`

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

The configuration is the same on every platform; only the binary path differs. See [Finding Your Binary Path](#finding-your-binary-path).

## Finding Your Binary Path

Build with `dx` rather than `cargo build`: `dx` bundles the files your app loads with `asset!()`, and a plain `cargo build` binary can't load them. `dx` prints the bundle path when the build finishes.

### Debug Build (for testing)

```bash
dx build --desktop
```

Binary locations:
- Windows: `target\dx\my_app\debug\windows\app\my_app.exe`
- Linux: `target/dx/my_app/debug/linux/app/my_app`
- macOS: `target/dx/my_app/debug/macos/MyApp.app/Contents/MacOS/my_app`

### Release Build (for production — driver and bridge compiled out)

```bash
dx build --desktop --release
```

Binary locations: as above, with `release` in place of `debug`.

**Always use a debug build for testing** so the driver and bridge code is present.

If your app doesn't use `asset!()`, `cargo build` also works; its binary is at `target/debug/my_app` (`target\debug\my_app.exe` on Windows).

## See Also

- [Quick Start](./quick-start.md) for getting started
- [App Setup](./app-setup.md) for setting up the Dioxus app
- [API Reference](./api-reference.md) for available functions
- [Log Forwarding](./log-forwarding.md) for logging configuration
- [Platform Support](./platform-support.md) for per-platform details
