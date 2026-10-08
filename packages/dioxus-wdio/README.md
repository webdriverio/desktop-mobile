# wdio-dioxus

Connects a Dioxus desktop app to [`@wdio/dioxus-service`](https://www.npmjs.com/package/@wdio/dioxus-service) so WebdriverIO can test it.

## Setup

```toml
[dependencies]
wdio-dioxus = "1"
```

```rust,ignore
fn main() {
    let mut config = dioxus::desktop::Config::new();

    #[cfg(debug_assertions)]
    {
        config = wdio_dioxus::install(config);
    }

    dioxus::LaunchBuilder::desktop().with_cfg(config).launch(App);
}
```

Call `install()` last in your `Config` chain. Dioxus keeps one `with_on_window` callback and one custom head, and a later call replaces the ones `install()` sets.

See the [App Setup guide](https://github.com/webdriverio/desktop-mobile/blob/main/packages/dioxus-service/docs/app-setup.md) for building and verifying the app.

## What `install()` Does

`install()` does nothing unless `@wdio/dioxus-service` launched the app. The service's `driverProvider` decides the rest, so switching provider doesn't change your app:

| `driverProvider` | `install()` |
|---|---|
| `'embedded'` (default) | Installs the bridge and starts the in-app WebDriver server |
| `'external'` | Installs the bridge only; `wdio-dioxus-driver` drives the app from outside. Not available in the service yet ([#713](https://github.com/webdriverio/desktop-mobile/issues/713)) |

The bridge provides `browser.dioxus.execute()`, mocking, log forwarding and window management.

## Custom Commands

```rust,ignore
config = wdio_dioxus::install_with_commands(config, |registry| {
    registry.register("get_version", |_args| Ok(serde_json::json!("1.2.3")));
});
```

Tests call them with `browser.dioxus.execute(({ invoke }) => invoke('get_version'))`.

## Features

| Feature | Default | |
|---|---|---|
| `embedded` | ✅ | The in-app WebDriver server. Without it, the app can only be driven by the `'external'` provider. |
