# WebdriverIO Tauri Plugin

[![tauri-plugin-wdio](https://img.shields.io/badge/tauri--plugin--wdio-FFC131)](https://crates.io/crates/tauri-plugin-wdio)
[![Version](https://img.shields.io/crates/v/tauri-plugin-wdio?color=28a745&labelColor=1a1a1a)](https://crates.io/crates/tauri-plugin-wdio)
[![Downloads](https://img.shields.io/crates/dr/tauri-plugin-wdio?color=6f42c1&labelColor=1a1a1a)](https://crates.io/crates/tauri-plugin-wdio)\
[![@wdio/tauri-plugin](https://img.shields.io/badge/@wdio-tauri--plugin-24C8DB)](https://www.npmjs.com/package/@wdio/tauri-plugin)
[![npm version](https://img.shields.io/npm/v/@wdio/tauri-plugin)](https://www.npmjs.com/package/@wdio/tauri-plugin)
[![npm downloads](https://img.shields.io/npm/dw/@wdio/tauri-plugin)](https://www.npmjs.com/package/@wdio/tauri-plugin)

A Tauri v2 plugin providing execute and mocking capabilities for WebDriverIO testing. This plugin enables E2E tests to execute JavaScript code in the frontend context with access to Tauri APIs and mock backend commands for isolated testing.

## Features

- **Execute JavaScript**: Run arbitrary JavaScript code in the frontend context with access to Tauri APIs
- **Command Mocking**: Intercept and mock Tauri backend commands for testing (via JS-side invoke interception)
- **Log Forwarding**: Forward backend and frontend logs to WebdriverIO's logger
- **Window Management**: Get active window label, list windows, get window states
- **TypeScript Support**: Full TypeScript definitions for the frontend API
- **Tauri v2 Compatible**: Built for Tauri v2 with proper plugin architecture

## Installation

### 1. Add to Cargo.toml

```toml
[dependencies]
tauri-plugin-wdio = "1"
```

### 2. Register Plugin in Your App

Add the plugin to your Tauri app's `src-tauri/src/main.rs`:

```rust
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_wdio::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

### 3. Configure Permissions

Add the plugin permissions to your `src-tauri/capabilities/default.json`:

```json
{
  "permissions": [
    "wdio:default"
  ]
}
```

The `wdio:default` permission includes all plugin capabilities. For fine-grained control, see [Permissions Detail](#permissions-detail).

### 4. Include Frontend JavaScript

Include the plugin's frontend JavaScript in your app:

```typescript
// In your main frontend file (e.g., main.ts, index.html)
import '@wdio/tauri-plugin';
```

## Usage

### With @wdio/tauri-service (Recommended)

The `@wdio/tauri-service` automatically uses this plugin when available, providing a high-level API:

```typescript
// Execute JavaScript with Tauri APIs
const result = await browser.tauri.execute(({ core }) => {
  return core.invoke('get_platform_info');
});

// Mock a Tauri command
const mock = await browser.tauri.mock('get_user');
await mock.mockReturnValue({ id: 1, name: 'Test User' });

// Execute the mocked command
const user = await browser.tauri.execute(({ core }) => {
  return core.invoke('get_user');
});
// user === { id: 1, name: 'Test User' }

// Restore all mocks
await browser.tauri.restoreAllMocks();
```

### Direct Frontend API

The plugin exposes `window.wdioTauri` with the following API:

```typescript
// Execute JavaScript with Tauri APIs
const result = await window.wdioTauri.execute((tauri) => tauri.core.invoke('get_platform_info'));

// Wait for plugin initialization
await window.wdioTauri.waitForInit();

// Cleanup
window.wdioTauri.cleanupAll();
```

## API Reference

### Frontend API (`window.wdioTauri`)

#### `execute(script, ...args): Promise<unknown>`

Execute JavaScript code in the frontend context. The script receives the Tauri APIs object as the first parameter.

**Parameters:**
- `script`: Function or string to execute (receives Tauri APIs as first parameter)
- `...args`: Additional arguments to pass to the script

**Returns:** Promise resolving to the script's return value

#### `waitForInit(): Promise<void>`

Wait for the plugin to fully initialize (Tauri APIs available).

#### `cleanupAll(): void`

Clean up all listeners, timers, and invoke interception.

#### `cleanupLogListeners(): void`

Clean up log forwarding listeners only.

#### `cleanupInvokeInterception(): void`

Clean up invoke interception only.

### Mocking

Mocking is handled via `@wdio/tauri-service`'s `browser.tauri.mock()` API, which uses JavaScript-side invoke interception (`window.__wdio_mocks__`). See the [Tauri Service API Reference](../packages/tauri-service/docs/api-reference.md) for the full mock API.

### Rust Commands

The plugin provides these Tauri commands:
- `plugin:wdio|execute` - Execute JavaScript in frontend context
- `plugin:wdio|log-frontend` - Forward frontend logs to Rust logger
- `plugin:wdio|debug-plugin` - Debug plugin state
- `plugin:wdio|get-active-window-label` - Get the active window label
- `plugin:wdio|list-windows` - List all windows
- `plugin:wdio|get-window-states` - Get window states

### Permissions Detail

The `wdio:default` permission grants every plugin command. Mocking is implemented entirely via JS-side invoke interception (`window.__wdio_mocks__`), so there are no mock-related Rust permissions.

| Permission                           | Description                              |
| ------------------------------------ | ---------------------------------------- |
| `wdio:allow-execute`                 | Execute JavaScript in frontend context   |
| `wdio:allow-emit-deep-link`          | Emit a deep link for `triggerDeeplink()` |
| `wdio:allow-log-frontend`            | Forward frontend logs                    |
| `wdio:allow-debug-plugin`            | Debug plugin state                       |
| `wdio:allow-get-active-window-label` | Get active window label                  |
| `wdio:allow-get-window-states`       | Get window states                        |
| `wdio:allow-list-windows`            | List windows                             |

## Configuration

### Permissions

The plugin requires explicit permissions in your Tauri app's capability file. Use `"wdio:default"` to include all permissions, or specify individual ones.

**Important:** Do not pass `.commands()` to `InlinedPlugin::new()` in `build.rs` - this causes Tauri to auto-generate invalid permission identifiers. The plugin uses explicit permissions defined in `permissions/default.toml`.

## Troubleshooting

### Plugin Not Available

If `window.wdioTauri` is undefined:
1. Ensure the plugin is registered in `main.rs`
2. Ensure permissions are configured in your capability file
3. Ensure the frontend JavaScript is included in your app
4. Check that `withGlobalTauri` is enabled in `tauri.conf.json`:

```json
{
  "app": {
    "withGlobalTauri": true
  }
}
```

### Permission Errors

If you get permission errors:
1. Verify your capability file includes `"wdio:default"` or the specific permissions needed
2. Ensure the capability file is referenced correctly in `tauri.conf.json`
3. Clean and rebuild: `cargo clean && pnpm build`

### Execute Timeout

If execute commands timeout:
1. Check that the script is valid JavaScript
2. Ensure `window.__TAURI__` is available
3. Verify the script doesn't have infinite loops
4. Check browser console for errors

## Examples

See the test fixtures in `fixtures/e2e-apps/tauri/` for complete examples of:
- Plugin registration
- Permission configuration
- Frontend integration
- Test usage

## License

MIT OR Apache-2.0
