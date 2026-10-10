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

`install()` does nothing unless `@wdio/dioxus-service` launched the app. When it did, `install()` starts the in-app WebDriver server the service connects to, and installs the bridge, which provides `browser.dioxus.execute()`, mocking, log forwarding and window management.

## Custom Commands

```rust,ignore
config = wdio_dioxus::install_with_commands(config, |registry| {
    registry.register("get_version", |_args| Ok(serde_json::json!("1.2.3")));
});
```

Tests call them with `browser.dioxus.execute(({ invoke }) => invoke('get_version'))`.
