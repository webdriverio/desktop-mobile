# wdio-dioxus-bridge

Rust bridge crate that exposes a `wdio://` IPC channel and automation
detection inside Dioxus desktop apps, consumed by
[`@wdio/dioxus-service`](../dioxus-service/).

## v1 status

This crate is being built up incrementally. The current published surface is:

- `wdio_dioxus_bridge::install(config) -> Config` — drop-in helper that wires the
  bridge into your Dioxus `Config`.
- `wdio_dioxus_bridge::automation::is_requested()` — true when
  `DIOXUS_WEBVIEW_AUTOMATION=true` is set in the process env (i.e. the app is
  running under `@wdio/dioxus-service`).

The full bridge IPC (`wdio://` custom protocol + invoke command bus + log
forwarder + guest-js bundle) lands in subsequent Phase 2 commits.

## Quick start

```toml
[dev-dependencies]
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

## Naming

The companion npm package shipping the guest-js bundle is `@wdio/dioxus-bridge`
(no `-js` suffix), matching the convention from `@wdio/tauri-plugin`. The Rust
crate is named `wdio-dioxus-bridge` ("bridge" rather than "plugin" because
Dioxus has no plugin-trait system — see
`packages/native-core/src/driverProcess.ts` discussion).
