# wdio-dioxus-bridge

Rust bridge crate that exposes a `wdio://` IPC channel and automation
detection inside Dioxus desktop apps, consumed by
[`@wdio/dioxus-service`](../dioxus-service/).

## Features

- **`install(config)`** — wires the bridge into your Dioxus `desktop::Config`. Registers the `wdio://` custom protocol, injects the guest-js bundle, and activates log forwarding. It does **not** start a WebDriver server; see [Quick Start](#quick-start).
- **`automation::is_requested()`** — returns `true` when `DIOXUS_WEBVIEW_AUTOMATION=true` is set in the process environment (i.e. the app is running under `@wdio/dioxus-service`).
- **`wdio://` custom protocol** — IPC channel between the service and the webview, used for execute, mock dispatch, and log forwarding.
- **Mock dispatch** — guest-js bundle injected into the webview patches the invoke API and exposes `window.__wdio_mocks__` for per-command mock registration.
- **Log forwarding** — Rust `log` crate output is captured and forwarded to the WDIO log capture pipeline. Frontend console forwarding is handled by the guest-js bundle.
## Quick Start

To use `@wdio/dioxus-service`, don't add this crate directly. Add
[`wdio-dioxus-embedded-driver`](../dioxus-embedded-driver/) instead: its
`install()` installs this bridge **and** starts the WebDriver server the
service connects to. Calling `wdio_dioxus_bridge::install(config)` on its own
doesn't start that server, so the service times out waiting for it.

```toml
# Cargo.toml
[dependencies]
wdio-dioxus-embedded-driver = "1"
```

Wire into `main.rs`, guarded for debug builds so the driver and bridge never
ship in release binaries:

```rust,ignore
fn main() {
    let mut config = dioxus::desktop::Config::new();

    #[cfg(debug_assertions)]
    {
        config = wdio_dioxus_embedded_driver::install(config);
    }

    dioxus::LaunchBuilder::desktop().with_cfg(config).launch(App);
}
```

> The `#[cfg(debug_assertions)]` guard is intentional — production builds
> should not ship test plumbing. See
> `packages/dioxus-service/docs/app-setup.md` for the rationale.

## How It Works

When the bridge is installed (by `wdio_dioxus_embedded_driver::install()`, or
directly via `install(config)`):

1. Logs whether `DIOXUS_WEBVIEW_AUTOMATION` is set. This doesn't gate anything; the bridge installs either way.
2. Registers the `wdio://` custom protocol on the Wry/Dioxus webview (`http://wdio.invoke/` on Windows).
3. Registers built-in commands for log forwarding and window management.
4. Injects the guest-js bundle into the webview.

The bridge never starts a WebDriver server itself; `wdio-dioxus-embedded-driver`
does that after installing the bridge.

The bridge uses Dioxus's webview configuration API, not Dioxus's plugin-trait system (Dioxus has no such system). This is why it is called a "bridge" rather than a "plugin".

## Naming

The companion npm package `@wdio/dioxus-bridge` ships the guest-js bundle (no `-js` suffix, matching the convention from `@wdio/tauri-plugin`). It is **not a separate user-installable package** — `build.rs` bundles it into the Rust crate at compile time, so no separate npm install is needed. The Rust crate is named `wdio-dioxus-bridge` ("bridge" rather than "plugin" because Dioxus has no plugin-trait system).

## Platform Support

| Platform | Status |
|----------|--------|
| Windows  | ✅ |
| Linux    | ✅ |
| macOS    | ✅ |

## See Also

- [App Setup guide](../dioxus-service/docs/app-setup.md) — full integration instructions
- [`@wdio/dioxus-service`](../dioxus-service/) — the WebdriverIO service
- [`wdio-dioxus-embedded-driver`](../dioxus-embedded-driver/) — the embedded WebDriver server
- [v1.0.0 Release Notes](./docs/release-notes/v1.0.0.md)
