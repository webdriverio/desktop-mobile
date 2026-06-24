# Tauri Plugin Setup

## Overview

The `tauri-plugin-wdio` is a **required** Tauri plugin that enables WebdriverIO testing of Tauri applications. It provides:

- **Execute API** - Run JavaScript code from tests with access to Tauri APIs
- **Mocking Support** - Mock Tauri backend commands for isolated testing
- **Log Forwarding** - Capture console logs from both frontend and backend
- **Invoke Interception** - Enable mocking without backend command modifications

## Two WDIO Plugins

There are two Tauri plugins for WebdriverIO testing:

| Plugin | Package | Purpose | Required |
|--------|---------|---------|----------|
| `tauri-plugin-wdio` | Rust + JS | Execute API, mocking, log forwarding | **Yes** |
| `tauri-plugin-wdio-webdriver` | Rust only | Embedded WebDriver server | Only for embedded provider |

### When You Need Each

- **`tauri-plugin-wdio`** - Always required for:
  - Executing JavaScript in the frontend (`browser.tauri.execute()`)
  - Mocking Tauri commands (`browser.tauri.mock()`)
  - Capturing frontend and backend logs

- **`tauri-plugin-wdio-webdriver`** - Required when using the embedded driver provider:
  - Provides built-in WebDriver HTTP server
  - Eliminates need for external tauri-driver
  - Enables native macOS testing without CrabNebula
  - Auto-detected on macOS; signal via `TAURI_WEBDRIVER_PORT` on Windows/Linux

## Why Is It Required?

The `@wdio/tauri-service` explicitly checks for the plugin and will fail if it's not available:

```
Error: Tauri plugin not available. Make sure @wdio/tauri-plugin is installed and registered in your Tauri app.
```

### What Works Without the Plugin

Only basic WebDriver operations work without the plugin:
- Element interactions (click, type, etc.)
- Navigation and page access
- Basic WebDriver commands

### What Requires the Plugin

All advanced testing features require the plugin:
- ✅ `browser.tauri.execute()` - Execute JavaScript with Tauri APIs
- ✅ `browser.tauri.mock()` - Mock backend commands
- ✅ All mocking operations
- ✅ Console log capture
- ✅ Backend log forwarding

## Installation Steps

### Step 1: Add Cargo Dependency

Add the plugin to your `src-tauri/Cargo.toml`:

```toml
[dependencies]
tauri = { version = "2", features = ["..your other features.."] }
tauri-plugin-wdio = "1"
```

### Step 2: Register Plugin in Rust

Add the plugin initialization to your `src-tauri/src/main.rs`:

```rust
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_wdio::init())  // Add this line
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

Place it anywhere in the plugin chain - typically after other plugins.

### Step 3: Add Tauri Permissions

The plugin requires WDIO permissions in your capabilities. Edit `src-tauri/capabilities/default.json`:

```json
{
  "identifier": "default",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:default",
    "wdio:default"
  ]
}
```

Or use individual permissions if you prefer fine-grained control:

```json
{
  "permissions": [
    "core:default",
    "core:window:default",
    "wdio:allow-execute",
    "wdio:allow-log-frontend",
    "wdio:allow-debug-plugin",
    "wdio:allow-get-active-window-label",
    "wdio:allow-get-window-states",
    "wdio:allow-list-windows"
  ]
}
```

> **Note:** Mocking is implemented entirely on the JavaScript side via invoke interception (`window.__wdio_mocks__`), so there are no `wdio:allow-set-mock` / `allow-clear-mocks` style permissions to configure.

### Step 4: Enable Global Tauri API

Make sure `withGlobalTauri` is enabled in `src-tauri/tauri.conf.json`:

```json
{
  "app": {
    "withGlobalTauri": true,
    "windows": [
      {
        "title": "My App",
        "width": 800,
        "height": 600
      }
    ],
    "security": {
      "capabilities": ["default"]
    }
  }
}
```

### Step 5: Import Frontend Plugin

Import the frontend plugin in your main frontend entry file (usually `index.html` or `main.ts`):

**In HTML:**
```html
<script type="module">
  import '@wdio/tauri-plugin';
</script>
```

**In TypeScript/JavaScript:**
```typescript
import '@wdio/tauri-plugin';
```

This import must happen **before** your tests run. The plugin auto-initializes on import and sets up:
- `window.wdioTauri` API
- Console forwarding
- Invoke interception for mocking
- Event listeners for backend logs

### Step 6: Build and Verify

Build your Tauri app:

```bash
cd src-tauri
cargo build --release
```

The build should complete successfully without errors about the plugin.

## Verifying the Plugin Installation

### Method 1: Check Browser Console

After starting your test session, the plugin will log initialization messages:

```
[WDIO Plugin] Initializing...
[WDIO Plugin] Successfully initialized
```

### Method 2: Test Plugin Availability

In a test, check if the plugin is available:

```typescript
it('should have plugin available', async () => {
  const available = await browser.tauri.isTauriApiAvailable?.();
  expect(available).toBe(true);
});
```

### Method 3: Try Execute API

The execute API will work if the plugin is properly installed:

```typescript
it('should execute JavaScript', async () => {
  const result = await browser.tauri.execute(() => {
    return window.location.href;
  });
  expect(result).toBeDefined();
});
```

## Troubleshooting Plugin Issues

### "Tauri plugin not available" Error

This means the plugin is not detected. Check:

1. **Plugin registered in Rust**
   ```rust
   .plugin(tauri_plugin_wdio::init())
   ```

2. **Frontend import present**
   ```typescript
   import '@wdio/tauri-plugin';
   ```

3. **`withGlobalTauri` enabled**
   ```json
   {
     "app": {
       "withGlobalTauri": true
     }
   }
   ```

4. **Permissions configured**
   Check that `"wdio:default"` is in your capabilities permissions.

### "window.wdioTauri is undefined" Error

The frontend plugin didn't initialize. Make sure:

1. The import statement is in your **main entry point**, before tests run
2. You're not running in an iframe or separate context
3. The app has time to initialize (add a small delay if needed):

```typescript
it('should have wdioTauri', async () => {
  // Give plugin time to initialize
  await browser.pause(500);

  const hasPlugin = 'wdioTauri' in window;
  expect(hasPlugin).toBe(true);
});
```

### Mocking Doesn't Work

Make sure:

1. Plugin is installed and available (see verification methods above)
2. You're using `browser.tauri.mock()`, not trying to mock directly
3. The mock is set up **before** calling the command:

```typescript
// ✅ Correct
const mock = await browser.tauri.mock('my_command');
await mock.mockReturnValue('test');
await browser.tauri.execute(({ core }) => core.invoke('my_command'));

// ❌ Wrong - mock set up after calling command
await browser.tauri.execute(({ core }) => core.invoke('my_command'));
const mock = await browser.tauri.mock('my_command');
```

### Plugin Compilation Errors

If you get Rust compilation errors:

1. **Ensure Rust toolchain is up to date**
   ```bash
   rustup update
   ```

2. **Clear Cargo cache**
   ```bash
   cd src-tauri
   cargo clean
   cargo build --release
   ```

3. **Check Tauri version compatibility**
   - tauri-plugin-wdio requires **Tauri v2.0+**
   - If you're on Tauri v1, this plugin won't work

4. **Check dependency versions**
   ```toml
   tauri = { version = "2", ... }
   tauri-plugin-wdio = "1"
   ```

## Plugin Architecture

### How It Works

The plugin consists of two parts:

1. **Rust Backend** (`packages/tauri-plugin/src/`)
   - Provides Tauri commands: `execute`, `log_frontend`, `debug_plugin`
   - Handles script execution via `window.eval()`
   - Manages result serialization

2. **Frontend JavaScript** (`packages/tauri-plugin/guest-js/`)
   - Auto-initializes on import
   - Exposes `window.wdioTauri` API
   - Intercepts `window.__TAURI__.core.invoke` for mocking
   - Forwards console logs to Tauri logger

### Plugin Lifecycle

When you import `@wdio/tauri-plugin`:

1. Plugin code loads and detects Tauri APIs
2. Sets up console forwarding
3. Sets up invoke interception for mocking
4. Registers event listeners for backend logs
5. Exposes `window.wdioTauri` object
6. On page unload, cleans up listeners and timers

### Permissions Detail

The `wdio:default` permission includes every plugin command:

- `wdio:allow-execute` - Execute JavaScript in frontend context
- `wdio:allow-log-frontend` - Forward frontend logs
- `wdio:allow-debug-plugin` - Debug plugin state
- `wdio:allow-get-active-window-label` - Get active window label
- `wdio:allow-get-window-states` - Get window states
- `wdio:allow-list-windows` - List windows

Mocking is implemented entirely on the JavaScript side via invoke interception, so there are no mock-related Rust permissions.

If you want a smaller surface, you can grant a subset — `wdio:allow-execute` alone is enough to run scripts and use the mocking API:

```json
{
  "permissions": [
    "wdio:allow-execute"
  ]
}
```

## Production Considerations

### Should I Include the Plugin in Production?

**No**, the plugin is **test-only**. For production builds:

1. **Conditionally register the plugin**
   ```rust
   fn main() {
       let mut builder = tauri::Builder::default();

       #[cfg(debug_assertions)]
       {
           builder = builder.plugin(tauri_plugin_wdio::init());
       }

       builder
           .run(tauri::generate_context!())
           .expect("error while running tauri application");
   }
   ```

2. **Or use feature flags**
   ```toml
   [features]
   wdio = ["dep:tauri-plugin-wdio"]

   [dependencies]
   tauri-plugin-wdio = { version = "1", optional = true }
   ```

   ```rust
   fn main() {
       let mut builder = tauri::Builder::default();

       #[cfg(feature = "wdio")]
       {
           builder = builder.plugin(tauri_plugin_wdio::init());
       }

       builder
           .run(tauri::generate_context!())
           .expect("error while running tauri application");
   }
   ```

3. **Build release without the plugin**
   ```bash
   cargo build --release
   ```

### Plugin Security

The plugin:
- Only accepts code from WebdriverIO service (not from page scripts)
- Cannot access browser or system permissions without being granted
- Is disabled in production builds
- Requires explicit `wdio:` permissions in capabilities

## Next Steps

Once the plugin is installed and verified:

1. Read [Quick Start](./quick-start.md) for minimal test setup
2. See [API Reference](./api-reference.md) for available functions
3. Check [Usage Examples](./usage-examples.md) for testing patterns
4. View [Configuration](./configuration.md) for service options

## Plugin 2: tauri-plugin-wdio-webdriver (Optional - Embedded WebDriver)

This plugin embeds a W3C WebDriver HTTP server directly in your Tauri application. Use it when you want to test on macOS without CrabNebula, or when you prefer not to install an external driver.

### Requirements

- Tauri v2.0+
- Embedded provider selected (auto-detected on macOS, or set `driverProvider: 'embedded'` / `TAURI_WEBDRIVER_PORT`)

### Installation

#### 1. Add Cargo Dependency

```toml
[target.'cfg(debug_assertions)'.dependencies]
tauri-plugin-wdio-webdriver = "1"
```

#### 2. Register Plugin in Rust

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

#### 3. Add Permissions

```json
{
  "identifier": "default",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:window:default",
    "wdio-webdriver:default"
  ]
}
```

> The `wdio-webdriver:default` set currently grants no IPC permissions — the plugin is an in-process HTTP server, not a command surface — but listing it ensures Tauri loads the plugin's ACL manifest.

### Configuration

The embedded WebDriver server runs on port `4445` by default. To customize:

```typescript
// In wdio.conf.ts
services: [['@wdio/tauri-service', {
  driverProvider: 'embedded',
  embeddedPort: 4445,  // Optional, defaults to 4445
}]]
```

Or via environment variable (also triggers auto-detection on Windows/Linux):
```bash
TAURI_WEBDRIVER_PORT=4445 npx wdio run wdio.conf.ts
```

### How It Works

1. The service spawns your Tauri app with `TAURI_WEBDRIVER_PORT` environment variable
2. The app starts an HTTP WebDriver server on that port
3. WebdriverIO connects directly to that port (no tauri-driver intermediary)
4. On test completion, the service terminates the app

### Differences from External Driver

| Aspect | External Driver (external/crabnebula) | Embedded Server |
|--------|--------------------------------------|-----------------|
| Architecture | Separate driver process | HTTP server in-app |
| macOS support | Requires CrabNebula | Native |
| Setup complexity | Higher (driver installation) | Lower (no external deps) |
| Port management | Service manages | Service + app coordinate |

## See Also

- [Tauri Plugin Documentation](https://v2.tauri.app/develop/plugins/)
- [WebdriverIO Documentation](https://webdriver.io/docs)
- [Tauri Application Setup](./quick-start.md#tauri-application-setup)
