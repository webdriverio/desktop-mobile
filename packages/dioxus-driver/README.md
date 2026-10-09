# wdio-dioxus-driver

WebDriver intermediary node for [Dioxus](https://dioxuslabs.com/) desktop applications. Forked from [`tauri-driver`](https://github.com/tauri-apps/tauri/tree/dev/crates/tauri-driver) (Apache-2.0 OR MIT, Tauri Programme within The Commons Conservancy).

## Why fork?

`tauri-driver` is ~80% framework-agnostic WebDriver-proxy glue, but its capability namespace (`tauri:options`) and automation env var (`TAURI_WEBVIEW_AUTOMATION`) name it explicitly for Tauri. We use `wdio-dioxus-driver` rather than the unprefixed `dioxus-driver` to leave that namespace free for the Dioxus project itself.

## Diff vs. upstream

| Concern | upstream `tauri-driver` | `wdio-dioxus-driver` |
|---|---|---|
| Capability key | `tauri:options` | `dioxus:options` |
| Automation env var | `TAURI_WEBVIEW_AUTOMATION` + legacy `TAURI_AUTOMATION` | `DIOXUS_WEBVIEW_AUTOMATION` only |
| Native driver mapping (Windows) | `ms:edgeOptions` | unchanged |
| Native driver mapping (Linux) | `webkitgtk:browserOptions` | unchanged |
| Crate name | `tauri-driver` | `wdio-dioxus-driver` |
| Binary name | `tauri-driver` | `wdio-dioxus-driver` |

## Platform support

| Platform | Status |
|---|---|
| Windows | ✅ Supported in v1 |
| Linux | 🚫 Blocked until Dioxus exposes Wry's automation toggle ([#713](https://github.com/webdriverio/desktop-mobile/issues/713)) |
| macOS | ❌ Not supported (inherits upstream `tauri-driver`'s limitation) |

## Install

```sh
cargo install wdio-dioxus-driver --locked
```

## Use

`@wdio/dioxus-service` doesn't start it yet, so run it yourself and point WebdriverIO's `hostname` and `port` at it:

```sh
wdio-dioxus-driver --port 4444 --native-port 4445
```

## Upstream-sync policy

We track upstream `tauri-driver` minor versions. Sync calendar: quarterly. Sync procedure:

1. `git fetch tauri-upstream && git diff tauri-upstream/dev:crates/tauri-driver our:packages/dioxus-driver`
2. Apply non-rename changes verbatim where possible.
3. Re-test on Windows.
