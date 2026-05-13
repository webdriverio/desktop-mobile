# wdio-dioxus-bridge

Rust bridge crate that exposes a `wdio://` IPC channel and automation
detection inside Dioxus desktop apps, consumed by
[`@wdio/dioxus-service`](../dioxus-service/).

## Features

- **`install(config)`** — drop-in helper that wires the bridge into your Dioxus `desktop::Config`. Registers the `wdio://` custom protocol, starts the embedded WebDriver server, injects the guest-js bundle, and activates log forwarding — all in a single call.
- **`automation::is_requested()`** — returns `true` when `DIOXUS_WEBVIEW_AUTOMATION=true` is set in the process environment (i.e. the app is running under `@wdio/dioxus-service`).
- **`wdio://` custom protocol** — IPC channel between the service and the webview, used for execute, mock dispatch, and log forwarding.
- **Mock dispatch** — guest-js bundle injected into the webview patches the invoke API and exposes `window.__wdio_mocks__` for per-command mock registration.
- **Log forwarding** — Rust `log` crate output is captured and forwarded to the WDIO log capture pipeline. Frontend console forwarding is handled by the guest-js bundle.
- **Embedded WebDriver server** — `wdio-dioxus-embedded-driver` is wired in automatically; no external driver process needed.

## Quick Start

```toml
# Cargo.toml
[dependencies]
wdio-dioxus-bridge = "1"
```

Wire into `main.rs`, guarded for debug builds so the bridge never ships in
release binaries:

```rust,ignore
fn main() {
    let mut config = dioxus::desktop::Config::new();

    #[cfg(debug_assertions)]
    {
        config = wdio_dioxus_bridge::install(config);
    }

    dioxus::LaunchBuilder::desktop().with_cfg(config).launch(App);
}
```

> The `#[cfg(debug_assertions)]` guard is intentional — production builds
> should not ship test plumbing. See
> `packages/dioxus-service/docs/plugin-setup.md` for the rationale.

## How It Works

When `install(config)` is called:

1. Checks `DIOXUS_WEBVIEW_AUTOMATION`. If not set, returns config unchanged (no-op).
2. Registers the `wdio://` custom protocol on the Wry/Dioxus webview.
3. Starts `wdio-dioxus-embedded-driver`'s HTTP server on `DIOXUS_WEBVIEW_AUTOMATION_PORT`.
4. Injects the guest-js bundle into the webview.
5. Starts the log forwarder for Rust `log` crate output.

The bridge uses Dioxus's webview configuration API, not Dioxus's plugin-trait system (Dioxus has no such system). This is why it is called a "bridge" rather than a "plugin".

## Naming

The companion npm package shipping the guest-js bundle is `@wdio/dioxus-bridge`
(no `-js` suffix), matching the convention from `@wdio/tauri-plugin`. The Rust
crate is named `wdio-dioxus-bridge` ("bridge" rather than "plugin" because
Dioxus has no plugin-trait system).

## Platform Support

| Platform | Status |
|----------|--------|
| Windows  | ✅ |
| Linux    | ✅ |
| macOS    | ✅ |

## See Also

- [Bridge Setup guide](../dioxus-service/docs/plugin-setup.md) — full integration instructions
- [`@wdio/dioxus-service`](../dioxus-service/) — the WebdriverIO service
- [`wdio-dioxus-embedded-driver`](../dioxus-embedded-driver/) — the embedded WebDriver server
- [v1.0.0 Release Notes](./docs/release-notes/v1.0.0.md)
