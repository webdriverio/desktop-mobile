# wdio-dioxus-embedded-driver

In-process WebDriver server for [Dioxus](https://dioxuslabs.com/) desktop applications. Installing it also installs [`wdio-dioxus-bridge`](../dioxus-bridge/).

## What Is It?

`wdio-dioxus-embedded-driver` is a Rust crate that implements a W3C WebDriver HTTP server that runs **inside your Dioxus application process**. `wdio_dioxus_embedded_driver::install(config)` installs the bridge and starts this server, which listens for WebDriver connections from `@wdio/dioxus-service`.

This is the component that makes the `'embedded'` driver provider work. It means you do not need any external driver process (`wdio-dioxus-driver`, `webkit2gtk-driver`, or `msedgedriver`) — the WebDriver server lives inside the app itself.

## Quick Start

```toml
# Cargo.toml
[dependencies]
wdio-dioxus-embedded-driver = "1"
```

Wire into `main.rs`, guarded for debug builds so the driver never ships in release binaries:

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

Call `install()` last in your `Config` builder chain so later calls don't shadow the bridge's `with_on_window` hook. To register custom commands for `browser.dioxus.execute()`, use `install_with_commands(config, |registry| { ... })` instead.

Build the app with `dx build --desktop` rather than `cargo build`, so the files it loads with `asset!()` are bundled. See the [Bridge Setup guide](../dioxus-service/docs/plugin-setup.md) for the full instructions.

## How It Works

1. `@wdio/dioxus-service` launches your debug Dioxus binary with environment variables:
   - `DIOXUS_WEBVIEW_AUTOMATION=true`
   - `WDIO_EMBEDDED_PORT=<port>` (default 4444, unique per capability)

2. `wdio_dioxus_embedded_driver::install(config)` installs the bridge and starts the HTTP server on `127.0.0.1` at the port in `WDIO_EMBEDDED_PORT` (4444 if unset). It does this on every debug launch, whether or not the service is driving the app.

3. `@wdio/dioxus-service` polls the `/status` endpoint until the server is ready, then establishes a WebDriver session.

4. WebDriver commands are routed to the webview through the bridge's IPC channel: the injected guest-js polls for script execution requests, runs them, and posts the results back.

## Platform Support

The embedded driver works on all three platforms:

| Platform | Status |
|----------|--------|
| Windows  | ✅ |
| Linux    | ✅ |
| macOS    | ✅ |

This is why `'embedded'` is the recommended driver provider for `@wdio/dioxus-service` — it eliminates platform-specific driver installation on all three OSes.

## Configuration

Port is controlled via `@wdio/dioxus-service`:

```typescript
// wdio.conf.ts
services: [['@wdio/dioxus-service', {
  driverProvider: 'embedded',
  embeddedPort: 4445,  // Optional, defaults to 4444
}]]
```

Or via environment variable:
```bash
WDIO_EMBEDDED_PORT=4445 npx wdio run wdio.conf.ts
```

## See Also

- [`wdio-dioxus-bridge`](../dioxus-bridge/) — the IPC bridge this crate installs
- [`@wdio/dioxus-service`](../dioxus-service/) — the WebdriverIO service
- [Bridge Setup](../dioxus-service/docs/plugin-setup.md) — how to integrate the driver into your Dioxus app
