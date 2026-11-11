# wdio-dioxus

Connects a Dioxus desktop app to [`@wdio/dioxus-service`](https://www.npmjs.com/package/@wdio/dioxus-service) so WebdriverIO can test it.

## Setup

```toml
[dependencies]
wdio-dioxus = "2"
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

### Apps With Their Own `with_on_window`

`install()` registers each window from a `with_on_window` callback, and with the embedded driver turns on the focus emulation it needs on Windows. If your app sets its own callback, set it after `install()` and call `wdio_dioxus::on_window` from it:

```rust,ignore
config = config.with_on_window(|window, dom| {
    // your window setup
    #[cfg(debug_assertions)]
    wdio_dioxus::on_window(&window, dom);
});
```

There's no equivalent for `with_custom_head`: under test, `install()` replaces a head your app sets, so stylesheets or scripts loaded there are missing. Normal runs aren't affected. See [#718](https://github.com/webdriverio/desktop-mobile/issues/718).

## What `install()` Does

`install()` does nothing unless `@wdio/dioxus-service` launched the app. When it did, `install()` starts the in-app WebDriver server the service connects to, and installs the bridge, which provides `browser.dioxus.execute()`, mocking, log forwarding and window management.

With the embedded driver, the default, it also turns on WebView2's focus emulation on Windows, so the page acts as focused while its window is in the background, and focus moves fire `focus` and `blur` as they do in a window in front. The page also stays focused and visible whatever the window does: switching windows fires no window `focus` or `blur`, a minimized window fires no `visibilitychange`, and its timers aren't slowed.

## Custom Commands

```rust,ignore
config = wdio_dioxus::install_with_commands(config, |registry| {
    registry.register("get_version", |_args| Ok(serde_json::json!("1.2.3")));
});
```

Tests call them with `browser.dioxus.execute(({ invoke }) => invoke('get_version'))`.
