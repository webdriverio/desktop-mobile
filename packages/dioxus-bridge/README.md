# wdio-dioxus-bridge

Internal crate used by [`wdio-dioxus-embedded-driver`](../dioxus-embedded-driver/) to connect a Dioxus desktop app to [`@wdio/dioxus-service`](../dioxus-service/). Apps don't add it themselves; see the [App Setup guide](../dioxus-service/docs/app-setup.md).

## What It Does

`install(config)` wires the bridge into the app's Dioxus `desktop::Config`:

- **`wdio://` custom protocol** (`http://wdio.invoke/` on Windows): the IPC channel between the service and the webview, used by execute, mocking and log forwarding.
- **Guest-js bundle**: injected into the page `<head>`. It exposes `window.__WDIO_DIOXUS__.invoke`, which the service patches at session start to intercept mocked commands. Under the embedded driver, it also runs the loop that executes WebDriver scripts.
- **Log forwarding**: sends the page's console output to the app's stdout, tagged so the service can tell it apart from the app's own logs.
- **Window registry**: labels windows (`main`, `window-1`, …) for `listWindows` and `switchWindow`.
- **`automation::is_requested()`**: returns `true` when the service launched the app (`DIOXUS_WEBVIEW_AUTOMATION=true`).

It's a "bridge" rather than a "plugin" because Dioxus has no plugin system; it hooks in through `desktop::Config`. The npm package `@wdio/dioxus-bridge` in this directory holds the guest-js source; `build.rs` embeds the built bundle in the crate.

## Platform Support

| Platform | Status |
|----------|--------|
| Windows  | ✅ |
| Linux    | ✅ |
| macOS    | ✅ |
