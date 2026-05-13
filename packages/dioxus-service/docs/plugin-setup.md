# Bridge Setup

## Overview

The `wdio-dioxus-bridge` is a **required** Rust crate that enables WebdriverIO testing of Dioxus desktop applications. It provides:

- **Execute API** - Run JavaScript code from tests with access to Dioxus IPC (`invoke`)
- **Mocking Support** - Mock Dioxus backend commands for isolated testing
- **Log Forwarding** - Capture console logs from both the frontend webview and Rust backend
- **Invoke Interception** - Enable mocking without modifying backend command handlers

Unlike Tauri's plugin system, Dioxus has no plugin-trait interface. The bridge is therefore a plain Rust crate (not a plugin) that wires itself into the Dioxus `desktop::Config` via a single `install()` call. It uses a `wdio://` custom protocol registered on the webview to communicate with the WDIO service process.

No capability permission system is involved — the bridge communicates through its own protocol channel, not through Dioxus's IPC machinery.

## What the Bridge Provides

| Feature | Available |
|---------|-----------|
| `browser.dioxus.execute()` | ✅ Yes |
| `browser.dioxus.mock()` and all mock operations | ✅ Yes |
| `browser.dioxus.listWindows()` / `switchWindow()` | ✅ Yes |
| Backend log capture (`captureBackendLogs`) | ✅ Yes |
| Frontend log capture (`captureFrontendLogs`) | ✅ Yes |
| Embedded WebDriver server | ✅ Yes (wired in automatically) |
| `browser.dioxus.triggerDeeplink()` | ✅ Yes (platform-level; no bridge needed) |

## Installation

### Step 1: Add the Bridge Crate

Add `wdio-dioxus-bridge` to your `Cargo.toml`. The recommended placement is under `[dependencies]` (not `[dev-dependencies]`) because the `#[cfg(debug_assertions)]` guard in your Rust code controls when the bridge code is actually compiled and linked:

```toml
[package]
name = "my_app"
version = "0.1.0"
edition = "2021"

[dependencies]
dioxus = { version = "0.6", features = ["desktop"] }
wdio-dioxus-bridge = "1"
```

> **Why `[dependencies]` and not `[dev-dependencies]`?**
>
> `[dev-dependencies]` are only available in test builds (`cargo test`), not in normal `cargo build` invocations. Since the bridge must be present for `cargo build` to compile the `#[cfg(debug_assertions)]`-guarded block, place it in `[dependencies]`. The guard ensures the bridge code is dead-code-eliminated from release builds (`cargo build --release`) automatically.

### Step 2: Wire the Bridge in `main.rs`

Call `wdio_dioxus_bridge::install(config)` inside a `#[cfg(debug_assertions)]` block:

```rust
use dioxus::prelude::*;

fn main() {
    let mut config = dioxus::desktop::Config::new();

    #[cfg(debug_assertions)]
    {
        config = wdio_dioxus_bridge::install(config);
    }

    dioxus::LaunchBuilder::desktop()
        .with_cfg(config)
        .launch(App);
}

#[component]
fn App() -> Element {
    rsx! {
        h1 { "Hello, Dioxus!" }
    }
}
```

The `#[cfg(debug_assertions)]` guard means:
- **Debug builds** (`cargo build`): bridge is active, WDIO can connect
- **Release builds** (`cargo build --release`): bridge code is not compiled, no test plumbing ships to users

### Step 3: Build in Debug Mode

For testing, always use a debug build:

```bash
cargo build
# Binary: target/debug/my_app (or my_app.exe on Windows)
```

The service's `appBinaryPath` or `dioxus:options.application` should point to the debug binary.

### Step 4: Verify

Build should complete without errors. The bridge registers itself on the Dioxus `Config` and the embedded WebDriver server is wired automatically — no further Rust code is needed.

## What the Bridge Does Internally

When `wdio_dioxus_bridge::install(config)` is called:

1. **Checks `DIOXUS_WEBVIEW_AUTOMATION`** via `wdio_dioxus_bridge::automation::is_requested()`. If the environment variable is not set, the bridge is a no-op.
2. **Registers a `wdio://` custom protocol** on the webview. This protocol is the IPC channel between the WDIO service process and the app's webview.
3. **Wires the embedded WebDriver server** (`wdio-dioxus-embedded-driver`) that listens on the port specified by `DIOXUS_WEBVIEW_AUTOMATION_PORT` (set by the service).
4. **Injects the guest-js bundle** into the webview. This bundle patches the invoke API for mock interception and sets up console log forwarding.
5. **Starts the log forwarder** that reads Rust `log` crate output and forwards it to the WDIO log capture pipeline.

This is controlled entirely by environment variables set by `@wdio/dioxus-service` when it launches the app binary. In a normal app run (not driven by WDIO), the bridge is loaded but takes no action.

## `automation::is_requested()`

You can use `wdio_dioxus_bridge::automation::is_requested()` in your app code to check whether the app is running under WDIO automation:

```rust
fn main() {
    let mut config = dioxus::desktop::Config::new();

    #[cfg(debug_assertions)]
    {
        if wdio_dioxus_bridge::automation::is_requested() {
            config = wdio_dioxus_bridge::install(config);
        }
    }

    dioxus::LaunchBuilder::desktop().with_cfg(config).launch(App);
}
```

`is_requested()` returns `true` when `DIOXUS_WEBVIEW_AUTOMATION=true` is set in the process environment. `@wdio/dioxus-service` sets this variable when launching your app. Calling `install(config)` without checking this first is also safe — the function checks internally and short-circuits.

## Production Considerations

The `#[cfg(debug_assertions)]` guard is the canonical way to ensure the bridge never ships in production:

```rust
fn main() {
    let mut config = dioxus::desktop::Config::new();

    // This entire block is removed by the compiler in release builds.
    #[cfg(debug_assertions)]
    {
        config = wdio_dioxus_bridge::install(config);
    }

    dioxus::LaunchBuilder::desktop().with_cfg(config).launch(App);
}
```

When you build with `cargo build --release`, the compiler strips the bridge entirely. No test plumbing is present in the binary that ships to users.

If you want additional isolation, you can use a Cargo feature flag:

```toml
[features]
wdio = ["dep:wdio-dioxus-bridge"]

[dependencies]
wdio-dioxus-bridge = { version = "1", optional = true }
```

```rust
fn main() {
    let mut config = dioxus::desktop::Config::new();

    #[cfg(feature = "wdio")]
    {
        config = wdio_dioxus_bridge::install(config);
    }

    dioxus::LaunchBuilder::desktop().with_cfg(config).launch(App);
}
```

Build with `cargo build --features wdio` for test builds, and `cargo build` for production.

## Troubleshooting

### "bridge not available" or execute always returns undefined

The bridge is not wired in. Check:

1. `wdio-dioxus-bridge = "1"` is in `[dependencies]` (not only `[dev-dependencies]`).
2. `wdio_dioxus_bridge::install(config)` is called inside `#[cfg(debug_assertions)]`.
3. You are building with `cargo build` (debug mode), not `cargo build --release`.
4. The `'dioxus:options'.application` path points to the debug binary.

### Compilation errors from `wdio-dioxus-bridge`

1. Update your Rust toolchain: `rustup update`
2. Clear Cargo cache: `cargo clean && cargo build`
3. Check that `dioxus` version is `0.6+`

## See Also

- [Quick Start](./quick-start.md) for minimal test setup
- [API Reference](./api-reference.md) for available functions
- [Usage Examples](./usage-examples.md) for testing patterns
- [Configuration](./configuration.md) for service options
- [wdio-dioxus-bridge README](../../dioxus-bridge/README.md) for bridge crate details
