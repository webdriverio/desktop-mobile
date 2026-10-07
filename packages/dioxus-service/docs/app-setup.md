# App Setup

## Overview

Your Dioxus app needs one crate, `wdio-dioxus-embedded-driver`, and one call to `wdio_dioxus_embedded_driver::install(config)`. That call:

- starts the WebDriver server that `@wdio/dioxus-service` connects to, inside your app's process
- installs `wdio-dioxus-bridge`, which provides the Execute API, mocking, log forwarding and window management

You don't add `wdio-dioxus-bridge` yourself. Calling `wdio_dioxus_bridge::install(config)` on its own sets up the bridge but doesn't start the WebDriver server, so the service can't connect.

This is the setup for the embedded provider (`driverProvider: 'embedded'`, the default), the only provider the service starts in v1. Its launcher doesn't start `wdio-dioxus-driver` for `'external'` yet.

Dioxus has no plugin system like Tauri's, so there are no plugins to register and no capability permissions to grant. `install()` wires everything into the Dioxus `desktop::Config`, and the bridge talks to the service over its own `wdio://` custom protocol on the webview.

## What `install()` Provides

| Feature | Available |
|---------|-----------|
| Embedded WebDriver server | ✅ Yes |
| `browser.dioxus.execute()` | ✅ Yes |
| `browser.dioxus.mock()` and all mock operations | ✅ Yes |
| `browser.dioxus.listWindows()` / `switchWindow()` | ✅ Yes |
| Backend log capture (`captureBackendLogs`) | ✅ Yes |
| Frontend log capture (`captureFrontendLogs`) | ✅ Yes |
| `browser.dioxus.triggerDeeplink()` | ✅ Yes (platform-level; works without `install()`) |

## Installation

### Step 1: Add the Embedded Driver Crate

Add `wdio-dioxus-embedded-driver` to your `Cargo.toml`. It depends on `wdio-dioxus-bridge`, so you don't need to add the bridge separately. The recommended placement is under `[dependencies]` (not `[dev-dependencies]`) because the `#[cfg(debug_assertions)]` guard in your Rust code controls when the driver code is actually compiled and linked:

```toml
[package]
name = "my_app"
version = "0.1.0"
edition = "2021"

[dependencies]
dioxus = { version = "0.7", features = ["desktop"] } # your Dioxus version (the bridge tracks the latest release)
wdio-dioxus-embedded-driver = "1"
```

> **Why `[dependencies]` and not `[dev-dependencies]`?**
>
> `[dev-dependencies]` are only available in test builds (`cargo test`), not in normal builds. Since the driver must be present for a debug build to compile the `#[cfg(debug_assertions)]`-guarded block, place it in `[dependencies]`. The guard ensures the driver and bridge code are dead-code-eliminated from release builds automatically.

### Step 2: Wire the Driver in `main.rs`

Call `wdio_dioxus_embedded_driver::install(config)` inside a `#[cfg(debug_assertions)]` block. Call it last in your `Config` builder chain, so later calls don't shadow the bridge's `with_on_window` hook:

```rust
use dioxus::prelude::*;

fn main() {
    let mut config = dioxus::desktop::Config::new();

    #[cfg(debug_assertions)]
    {
        config = wdio_dioxus_embedded_driver::install(config);
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
- **Debug builds** (`dx build --desktop`): driver and bridge are active, WDIO can connect
- **Release builds** (`dx build --desktop --release`): driver and bridge code is not compiled, no test plumbing ships to users

### Step 3: Build in Debug Mode

For testing, always use a debug build, and build with `dx` rather than `cargo build`:

```bash
dx build --desktop
```

`dx` bundles the files your app loads with `asset!()`. A plain `cargo build` binary can't resolve those paths, so stylesheets, images and fonts fail to load during tests. If your app doesn't use `asset!()`, `cargo build` also works, and the binary is at `target/debug/my_app`.

`dx` prints the bundle path when the build finishes. The debug binary is at:

| Platform | Binary path |
|----------|-------------|
| macOS | `target/dx/my_app/debug/macos/MyApp.app/Contents/MacOS/my_app` |
| Linux | `target/dx/my_app/debug/linux/app/my_app` |
| Windows | `target\dx\my_app\debug\windows\app\my_app.exe` |

The service's `appBinaryPath` or `dioxus:options.application` should point to the debug binary.

### Step 4: Verify

Run the debug binary, then check the embedded server from another terminal:

```bash
curl http://127.0.0.1:4444/status
```

Once the app's window has loaded, the server reports it's ready:

```json
{"value":{"message":"wdio-dioxus-embedded-driver is ready","ready":true}}
```

`"ready": false` ("waiting for webview") means the server is running but the window hasn't registered with the bridge yet. If nothing is listening on the port, the driver isn't installed or this is a release build; see [Troubleshooting](#troubleshooting).

## What Happens Internally

When `wdio_dioxus_embedded_driver::install(config)` is called:

1. **Sets a per-port webview data directory** in the system temp folder, so parallel app instances (multiremote) don't share WebView2/WebKit state.
2. **Installs the bridge**, which:
   - registers a `wdio://` custom protocol on the webview (`http://wdio.invoke/` on Windows). This protocol is the IPC channel between the WDIO service process and the app's webview.
   - registers built-in commands for log forwarding and window management.
   - injects the guest-js bundle into the webview. This bundle exposes `window.__WDIO_DIOXUS__.invoke` (which the service patches at session start to intercept mocked commands), sets up console log forwarding, and runs the polling loop that executes WebDriver scripts.
3. **Starts the embedded WebDriver server** on a background thread, listening on `127.0.0.1` at the port in `WDIO_EMBEDDED_PORT` (default `4444`). `@wdio/dioxus-service` sets this variable when it launches the app; change it with the `embeddedPort` service option.

None of this depends on the environment: every debug build that calls `install()` starts the server, including normal development runs. Use `automation::is_requested()` (below) if you only want it while WDIO is driving the app.

## `automation::is_requested()`

You can use `wdio_dioxus_embedded_driver::automation::is_requested()` in your app code to check whether the app is running under WDIO automation:

```rust
fn main() {
    let mut config = dioxus::desktop::Config::new();

    #[cfg(debug_assertions)]
    {
        if wdio_dioxus_embedded_driver::automation::is_requested() {
            config = wdio_dioxus_embedded_driver::install(config);
        }
    }

    dioxus::LaunchBuilder::desktop().with_cfg(config).launch(App);
}
```

`is_requested()` returns `true` when `DIOXUS_WEBVIEW_AUTOMATION=true` is set in the process environment. `@wdio/dioxus-service` sets this variable when launching your app. Without this check, `install()` runs on every debug launch.

## Production Considerations

The `#[cfg(debug_assertions)]` guard is the canonical way to ensure the driver and bridge never ship in production:

```rust
fn main() {
    let mut config = dioxus::desktop::Config::new();

    // This entire block is removed by the compiler in release builds.
    #[cfg(debug_assertions)]
    {
        config = wdio_dioxus_embedded_driver::install(config);
    }

    dioxus::LaunchBuilder::desktop().with_cfg(config).launch(App);
}
```

When you build with `dx build --desktop --release`, the compiler strips the driver and bridge entirely. No test plumbing is present in the binary that ships to users.

If you want additional isolation, you can use a Cargo feature flag:

```toml
[features]
wdio = ["dep:wdio-dioxus-embedded-driver"]

[dependencies]
wdio-dioxus-embedded-driver = { version = "1", optional = true }
```

```rust
fn main() {
    let mut config = dioxus::desktop::Config::new();

    #[cfg(feature = "wdio")]
    {
        config = wdio_dioxus_embedded_driver::install(config);
    }

    dioxus::LaunchBuilder::desktop().with_cfg(config).launch(App);
}
```

Build with `dx build --desktop --features wdio` for test builds, and `dx build --desktop` for production.

## Troubleshooting

### "Embedded WebDriver server did not become ready" or "bridge not available"

The embedded driver is not wired in. Check:

1. `wdio-dioxus-embedded-driver = "1"` is in `[dependencies]` (not only `[dev-dependencies]`).
2. `wdio_dioxus_embedded_driver::install(config)` is called inside `#[cfg(debug_assertions)]`. `wdio_dioxus_bridge::install(config)` alone doesn't start the WebDriver server.
3. You are building in debug mode (`dx build --desktop`), not with `--release`.
4. The `'dioxus:options'.application` path points to the debug binary.
5. Nothing else is listening on the embedded port (`4444` by default). Set `embeddedPort` to use a different one.

### Styles or images are missing during tests

The app was built with `cargo build`, which doesn't bundle the files loaded with `asset!()`. Build with `dx build --desktop` and point `'dioxus:options'.application` at the `dx` output (see [Step 3](#step-3-build-in-debug-mode)).

### Compilation errors from `wdio-dioxus-bridge`

`wdio-dioxus-bridge` tracks the latest Dioxus release; the exact version it supports is its own `dioxus-desktop` dependency — see the bridge's [dependencies on crates.io](https://crates.io/crates/wdio-dioxus-bridge).

1. Update your Rust toolchain: `rustup update`
2. Clear the Cargo cache: `cargo clean && cargo build`
3. Pin your `dioxus` to the same minor as the bridge's `dioxus-desktop` dependency (link above)

## See Also

- [Quick Start](./quick-start.md) for minimal test setup
- [API Reference](./api-reference.md) for available functions
- [Usage Examples](./usage-examples.md) for testing patterns
- [Configuration](./configuration.md) for service options
- [wdio-dioxus-bridge README](../../dioxus-bridge/README.md) for bridge crate details
- [wdio-dioxus-embedded-driver README](../../dioxus-embedded-driver/README.md) for embedded driver details
