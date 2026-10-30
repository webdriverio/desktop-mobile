# wdio-dioxus-embedded-driver

In-process WebDriver server for [Dioxus](https://dioxuslabs.com/) desktop applications. Installing it also installs [`wdio-dioxus-bridge`](../dioxus-bridge/).

> Apps should add [`wdio-dioxus`](../dioxus-wdio/) instead, which installs this server. Calling this crate's `install()` directly still works.

## What Is It?

`wdio-dioxus-embedded-driver` is a Rust crate that implements a W3C WebDriver HTTP server that runs **inside your Dioxus application process**. `wdio_dioxus_embedded_driver::install(config)` installs the bridge and starts this server, which listens for WebDriver connections from `@wdio/dioxus-service`.

This is the WebDriver server `@wdio/dioxus-service` connects to. It lives inside the app itself, so there's no driver to install.

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

Build the app with `dx build --desktop` rather than `cargo build`, so the files it loads with `asset!()` are bundled. See the [App Setup guide](../dioxus-service/docs/app-setup.md) for the full instructions.

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
| -------- | ------ |
| Windows  | ✅     |
| Linux    | ✅     |
| macOS    | ✅     |

## Limitations

Page and element screenshots fail with `unsupported operation`, so `takeScreenshot()`, `saveScreenshot()` and the visual service throw rather than get a blank image. Native screenshots are tracked in [#741](https://github.com/webdriverio/desktop-mobile/issues/741). On Windows and Linux, the external driver provider (`driverProvider: 'external'`) supports screenshots.

## Configuration

Port is controlled via `@wdio/dioxus-service`:

```typescript
// wdio.conf.ts
services: [
  [
    '@wdio/dioxus-service',
    {
      embeddedPort: 4445, // Optional, defaults to 4444
    },
  ],
];
```

Or via environment variable:
```bash
WDIO_EMBEDDED_PORT=4445 npx wdio run wdio.conf.ts
```

## Keyboard Events

Key actions (`browser.keys()`) send the `key`, `code`, `keyCode` and `shiftKey` a browser sends on a US keyboard: `a` is `code: 'KeyA'`, `keyCode: 65`, `A` is the same key with `shiftKey: true`, and `!` is `code: 'Digit1'`, `keyCode: 49` with `shiftKey: true`. A character with no key on a US keyboard gets `code: ''` and `keyCode: 0`. A newline is the Enter key and a backspace character the Backspace key, and a carriage return is skipped, so a `\r\n` line ending presses Enter once. For a newline and a backspace character, chromedriver sends the same `key` but an empty `code`. A tab is sent as a character, with the Tab key's `code` and `keyCode`, because the Tab key doesn't move focus in this driver yet ([#889](https://github.com/webdriverio/desktop-mobile/issues/889)).

Key events go to the focused element, even one inside an open shadow root. Element Send Keys (`setValue()`, `addValue()`) sets the text without keyboard events, so `keydown` handlers don't see it.

One difference from the W3C key tables: `\uE007` (WebdriverIO's `Key.Enter`) sends `code: 'Enter'`, and `\uE006` (Return) sends `code: 'NumpadEnter'`. The W3C tables assign them the other way round, but clients send `\uE007` for the Enter key, so a handler that checks `code === 'Enter'` matches it.

## See Also

- [`wdio-dioxus-bridge`](../dioxus-bridge/) — the IPC bridge this crate installs
- [`@wdio/dioxus-service`](../dioxus-service/) — the WebdriverIO service
- [App Setup](../dioxus-service/docs/app-setup.md) — how to integrate the driver into your Dioxus app
