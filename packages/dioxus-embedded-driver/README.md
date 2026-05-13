# wdio-dioxus-embedded-driver

In-process WebDriver server for [Dioxus](https://dioxuslabs.com/) desktop applications, wired in via [`wdio-dioxus-bridge`](../dioxus-bridge/).

## What Is It?

`wdio-dioxus-embedded-driver` is a Rust crate that implements a W3C WebDriver HTTP server that runs **inside your Dioxus application process**. When the bridge is installed (via `wdio_dioxus_bridge::install(config)`), this crate's server is started automatically and listens for WebDriver connections from `@wdio/dioxus-service`.

This is the component that makes the `'embedded'` driver provider work. It means you do not need any external driver process (`wdio-dioxus-driver`, `webkit2gtk-driver`, or `msedgedriver`) — the WebDriver server lives inside the app itself.

## How It Works

1. `@wdio/dioxus-service` launches your debug Dioxus binary with environment variables:
   - `DIOXUS_WEBVIEW_AUTOMATION=true`
   - `DIOXUS_WEBVIEW_AUTOMATION_PORT=<port>` (default 4445, unique per worker)

2. `wdio_dioxus_bridge::install(config)` checks for these variables, then starts `wdio-dioxus-embedded-driver`'s HTTP server on the specified port.

3. `@wdio/dioxus-service` polls the `/status` endpoint until the server is ready, then establishes a WebDriver session.

4. WebDriver commands are routed to the embedded server, which translates them to the Wry/Dioxus webview API.

## Platform Support

The embedded driver works on all three platforms:

| Platform | Status |
|----------|--------|
| Windows  | ✅ |
| Linux    | ✅ |
| macOS    | ✅ |

This is why `'embedded'` is the recommended driver provider for `@wdio/dioxus-service` — it eliminates platform-specific driver installation on all three OSes.

## Direct Use

This crate is **not intended for direct use**. It is a dependency of `wdio-dioxus-bridge` and is pulled in automatically when you add the bridge to your `Cargo.toml`.

To enable embedded driver testing, follow the [Bridge Setup guide](../dioxus-service/docs/plugin-setup.md) in `@wdio/dioxus-service`.

## Configuration

Port is controlled via `@wdio/dioxus-service`:

```typescript
// wdio.conf.ts
services: [['@wdio/dioxus-service', {
  driverProvider: 'embedded',
  embeddedPort: 4445,  // Optional, defaults to 4445
}]]
```

Or via environment variable:
```bash
DIOXUS_WEBVIEW_AUTOMATION_PORT=4445 npx wdio run wdio.conf.ts
```

## See Also

- [`wdio-dioxus-bridge`](../dioxus-bridge/) — the bridge crate that wires the embedded driver into your app
- [`@wdio/dioxus-service`](../dioxus-service/) — the WebdriverIO service
- [Bridge Setup](../dioxus-service/docs/plugin-setup.md) — how to integrate the bridge into your Dioxus app
