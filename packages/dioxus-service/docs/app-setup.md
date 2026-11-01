# App Setup

## Overview

Your Dioxus app needs one crate, `wdio-dioxus`, and one call to `wdio_dioxus::install(config)`. When `@wdio/dioxus-service` launches the app, that call:
- starts the WebDriver server that the service connects to, inside your app's process
- installs the bridge, which provides the Execute API, mocking, log forwarding and window management

When the app runs any other way, `install()` does nothing.

Dioxus has no plugin system like Tauri's, so there are no plugins to register and no capability permissions to grant. `install()` wires everything into the Dioxus `desktop::Config`, and the bridge talks to the service over its own `wdio://` custom protocol on the webview.

> **Upgrading from 1.0?** Apps that call `wdio_dioxus_embedded_driver::install(config)` keep working. To switch, replace the `wdio-dioxus-embedded-driver` dependency with `wdio-dioxus = "1"`, and the call with `wdio_dioxus::install(config)`. `install_with_commands` and `automation` work the same way. If your own `with_on_window` callback calls `window_state::register_window`, call `wdio_dioxus::on_window` instead (see [Apps With Their Own Window Callback](#apps-with-their-own-window-callback)).

## What `install()` Provides

- The embedded WebDriver server
- `browser.dioxus.execute()`
- `browser.dioxus.mock()` and all mock operations
- `browser.dioxus.listWindows()` and `switchWindow()`
- Backend and frontend log capture (`captureBackendLogs`, `captureFrontendLogs`)

`browser.dioxus.triggerDeeplink()` doesn't need `install()`: it opens the URL through the operating system.

## Installation

### Step 1: Add `wdio-dioxus`

Add `wdio-dioxus` to your `Cargo.toml`. The recommended placement is under `[dependencies]` (not `[dev-dependencies]`) because the `#[cfg(debug_assertions)]` guard in your Rust code controls when it's actually compiled and linked:

```toml
[package]
name = "my_app"
version = "0.1.0"
edition = "2021"

[dependencies]
dioxus = { version = "0.7", features = ["desktop"] } # your Dioxus version (wdio-dioxus tracks the latest release)
wdio-dioxus = "1"
```

> **Why `[dependencies]` and not `[dev-dependencies]`?**
>
> `[dev-dependencies]` are only available in test builds (`cargo test`), not in normal builds. Since `wdio-dioxus` must be present for a debug build to compile the `#[cfg(debug_assertions)]`-guarded block, place it in `[dependencies]`. The guard ensures its code is dead-code-eliminated from release builds automatically.

### Step 2: Call `install()` in `main.rs`

Call `wdio_dioxus::install(config)` inside a `#[cfg(debug_assertions)]` block. Call it last in your `Config` chain: a later `with_on_window` or `with_custom_head` call replaces the ones `install()` sets. If your app sets its own `with_on_window` callback, see [Apps With Their Own Window Callback](#apps-with-their-own-window-callback).

```rust
use dioxus::prelude::*;

fn main() {
    let mut config = dioxus::desktop::Config::new();

    #[cfg(debug_assertions)]
    {
        config = wdio_dioxus::install(config);
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
- **Debug builds** (`dx build --desktop`): `wdio-dioxus` is compiled in, and WDIO can connect when the service launches the app
- **Release builds** (`dx build --desktop --release`): `wdio-dioxus` is not compiled, so no test plumbing ships to users

### Step 3: Build in Debug Mode

For testing, always use a debug build, and build with `dx` rather than `cargo build`:

```bash
dx build --desktop
```

`dx` bundles the files your app loads with `asset!()`. A plain `cargo build` binary can't resolve those paths, so stylesheets, images and fonts fail to load during tests. If your app doesn't use `asset!()`, `cargo build` also works, and the binary is at `target/debug/my_app`.

`dx` prints the bundle path when the build finishes. The debug binary is at:

| Platform | Binary path                                                    |
| -------- | -------------------------------------------------------------- |
| macOS    | `target/dx/my_app/debug/macos/MyApp.app/Contents/MacOS/my_app` |
| Linux    | `target/dx/my_app/debug/linux/app/my_app`                      |
| Windows  | `target\dx\my_app\debug\windows\app\my_app.exe`                |

The service's `appBinaryPath` or `dioxus:options.application` should point to the debug binary.

### Step 4: Verify

`install()` only starts the server when the service launches the app, so set the variable the service sets when you run the debug binary yourself. Use the path for your platform from the table above:

```bash
# macOS and Linux
DIOXUS_WEBVIEW_AUTOMATION=true ./target/dx/my_app/debug/linux/app/my_app
```

```powershell
# Windows (PowerShell)
$env:DIOXUS_WEBVIEW_AUTOMATION = "true"; .\target\dx\my_app\debug\windows\app\my_app.exe
```

Then check the embedded server from another terminal:

```bash
curl http://127.0.0.1:4444/status
```

Once the app's window has loaded, the server reports it's ready:

```json
{
  "value": {
    "message": "wdio-dioxus-embedded-driver is ready",
    "ready": true
  }
}
```

`"ready": false` ("waiting for webview") means the server is running but the window hasn't registered with the bridge yet. If nothing is listening on the port, check that `DIOXUS_WEBVIEW_AUTOMATION=true` is set, that `main.rs` calls `install()`, and that this is a debug build; see [Troubleshooting](./troubleshooting.md#bridge-issues).

## Apps With Their Own Window Callback

`install()` registers each window with the bridge from a `with_on_window` callback, and Dioxus keeps only one. If your app needs its own, set it after `install()` and call `wdio_dioxus::on_window` from it:

```rust
#[cfg(debug_assertions)]
{
    config = wdio_dioxus::install(config);
}

config = config.with_on_window(|window, dom| {
    // your window setup

    #[cfg(debug_assertions)]
    wdio_dioxus::on_window(&window, dom);
});
```

Without it, the service never sees the app's windows, and startup fails with "the app's window never registered with the bridge".

`with_custom_head` has no equivalent: under test, `install()` replaces a head your app sets, so stylesheets or scripts loaded there are missing. Normal runs aren't affected. Load stylesheets from a component with `document::Stylesheet { href: asset!("/assets/main.css") }` instead, which doesn't use the custom head. See [#718](https://github.com/webdriverio/desktop-mobile/issues/718).

## What Happens Internally

When `@wdio/dioxus-service` launches the app, it sets `DIOXUS_WEBVIEW_AUTOMATION=true`, and `wdio_dioxus::install(config)`:
1. **Sets a per-port webview data directory** in the system temp folder, so parallel app instances (multiremote) don't share WebView2/WebKit state.
2. **Installs the bridge**, which:
   - registers a `wdio://` custom protocol on the webview (`http://wdio.invoke/` on Windows). This protocol is the IPC channel between the WDIO service process and the app's webview.
   - registers built-in commands for log forwarding and window management.
   - injects the guest-js bundle into the webview. This bundle exposes `window.__WDIO_DIOXUS__.invoke` (which the service patches at session start to intercept mocked commands), sets up console log forwarding, and runs the polling loop that executes WebDriver scripts.
3. **Starts the embedded WebDriver server** on a background thread, listening on `127.0.0.1` at the port in `WDIO_EMBEDDED_PORT` (default `4444`). `@wdio/dioxus-service` sets this variable when it launches the app; change it with the `embeddedPort` service option.

Without `DIOXUS_WEBVIEW_AUTOMATION=true`, `install()` returns the config unchanged, so normal development runs don't start the server.

## `automation::is_requested()`

`wdio_dioxus::automation::is_requested()` returns `true` when `DIOXUS_WEBVIEW_AUTOMATION=true` is set in the process environment, which `@wdio/dioxus-service` does when it launches your app. `install()` already checks it. Use it to change your own app's behaviour under test, as the [macOS background throttling workaround](./troubleshooting.md#macos-commands-stall-or-time-out-on-ci) does.

## Production Considerations

The `#[cfg(debug_assertions)]` guard is the canonical way to ensure `wdio-dioxus` never ships in production:

```rust
fn main() {
    let mut config = dioxus::desktop::Config::new();

    // This entire block is removed by the compiler in release builds.
    #[cfg(debug_assertions)]
    {
        config = wdio_dioxus::install(config);
    }

    dioxus::LaunchBuilder::desktop().with_cfg(config).launch(App);
}
```

When you build with `dx build --desktop --release`, the compiler strips `wdio-dioxus` entirely. No test plumbing is present in the binary that ships to users.

If you want additional isolation, you can use a Cargo feature flag:

```toml
[features]
wdio = ["dep:wdio-dioxus"]

[dependencies]
wdio-dioxus = { version = "1", optional = true }
```

```rust
fn main() {
    let mut config = dioxus::desktop::Config::new();

    #[cfg(feature = "wdio")]
    {
        config = wdio_dioxus::install(config);
    }

    dioxus::LaunchBuilder::desktop().with_cfg(config).launch(App);
}
```

Build with `dx build --desktop --features wdio` for test builds, and `dx build --desktop` for production.

## See Also

- [Quick Start](./quick-start.md) for minimal test setup
- [Troubleshooting](./troubleshooting.md) if the service can't connect or the build fails
- [API Reference](./api-reference.md) for available functions
- [Usage Examples](./usage-examples.md) for testing patterns
- [Configuration](./configuration.md) for service options
- [wdio-dioxus README](../../dioxus-wdio/README.md) for the crate's API
