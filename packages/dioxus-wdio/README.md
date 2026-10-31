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

Call `install()` last in your `Config` chain: a later `with_on_window` or `with_custom_head` call replaces the ones `install()` sets.

See the [App Setup guide](https://github.com/webdriverio/desktop-mobile/blob/main/packages/dioxus-service/docs/app-setup.md) for building and verifying the app.

### Apps With Their Own `with_on_window` or `with_custom_head`

`install()` registers each window from a `with_on_window` callback. If your app sets its own, set it after `install()` and call `wdio_dioxus::on_window` from it:

```rust,ignore
config = config.with_on_window(|window, dom| {
    // your window setup
    #[cfg(debug_assertions)]
    wdio_dioxus::on_window(&window, dom);
});
```

`install()` also injects the bridge `<script>` into the page `<head>` with `with_custom_head`. Prefer loading stylesheets and links from components with `document::Stylesheet` or `document::Link`, which don't use `with_custom_head`. If your app must call `with_custom_head`, call it after `install()` and append `wdio_dioxus::custom_head()` (which returns an empty string outside WDIO test runs):

```rust,ignore
let mut head = r#"<link rel="stylesheet" href="/assets/main.css">"#.to_string();
#[cfg(debug_assertions)]
head.push_str(&wdio_dioxus::custom_head());
config = config.with_custom_head(head);
```

## What `install()` Does

`install()` does nothing unless `@wdio/dioxus-service` launched the app. When it did, `install()` starts the in-app WebDriver server the service connects to, and installs the bridge, which provides `browser.dioxus.execute()`, mocking, log forwarding and window management.

## Custom Commands

```rust,ignore
config = wdio_dioxus::install_with_commands(config, |registry| {
    registry.register("get_version", |_args| Ok(serde_json::json!("1.2.3")));
});
```

Tests call them with `browser.dioxus.execute(({ invoke }) => invoke('get_version'))`.
