# Phase 2 — Wry / WebDriver plumbing (Tauri, Dioxus)

For apps that embed a system webview via **Wry** and expose no CDP. The test process drives a **W3C WebDriver** endpoint, and the app needs **in-app Rust plumbing** to inject test hooks. Two driver models (often both shipped); two in-app plumbing styles.

References: `packages/tauri-service/` + `packages/tauri-plugin/` (external driver, plugin crate); `packages/dioxus-service/` + `dioxus-bridge` / `dioxus-embedded-driver` / `dioxus-driver` (embedded driver, bridge crate).

## Driver models

### External provider — driver crate (`wdio-<framework>-driver`)

A WebDriver intermediary node, **forked from `tauri-driver`** (~200 LOC delta). It proxies WebDriver commands to the platform webview driver (`msedgedriver` on Windows / `webkit2gtk-driver` on Linux), which launches the app binary. Flow:

```
WDIO → wdio-<framework>-driver (port X) → msedgedriver/webkit2gtk-driver (X+1) → app binary
```

Fork delta (see `packages/dioxus-driver/`): rename crate + binary to `wdio-<framework>-driver`; capability namespace `tauri:options` → `<framework>:options`; env var `TAURI_WEBVIEW_AUTOMATION` → `<FRAMEWORK>_WEBVIEW_AUTOMATION`; drop the legacy `TAURI_AUTOMATION` form. Document the upstream-sync policy in the crate README. Cargo deps mirror `dioxus-driver/Cargo.toml` (hyper/hyper-util, pico-args, `win32job` on Windows, `signal-hook` on Unix). The service spawns/pools these via `@wdio/native-core`'s `DriverPool`/`DriverProcess`; `BaseLauncher.stopAllDrivers()` tears them down.

External is **not available on macOS** for Wry today, and on Linux depends on the framework exposing the automation toggle. Throw `SevereServiceError` for unsupported platform/provider combos (see `dioxus-service/src/launcher.ts` → `linuxExternalProviderUnsupported`, `macosExternalProviderUnsupported`).

### Embedded provider — in-process WebDriver server

**Recommended default, and supported by both shipped Wry services.** A W3C WebDriver HTTP server (Axum) compiled into the app. No external driver to install — **works on all three OSes** (macOS additionally requires the app-level `with_background_throttling` mitigation — see the macOS gotcha at the end of this file; without it the embedded loop silently hangs on headless CI). The service spawns the app directly, sets the automation env vars (`<FRAMEWORK>_WEBVIEW_AUTOMATION` + a port var — use `<FRAMEWORK>_WEBVIEW_AUTOMATION_PORT` for a new service as Dioxus does; Tauri's `TAURI_WEBDRIVER_PORT` predates the convention), polls `/status` until `ready: true`, then opens a WebDriver session pointed at that port.

**Two delivery routes, mirroring the in-app plumbing axis (below):**

- **Plugin route (Tauri)** — `tauri-plugin-wdio-webdriver` (`packages/tauri-plugin-webdriver/`, a *second* crate alongside the execute/mock plugin `tauri-plugin-wdio`). The app registers it explicitly: `tauri_plugin_wdio_webdriver::init()` in `lib.rs`. If the server doesn't come up, the service error tells the user to register the plugin or fall back to `driverProvider: 'external'`.
- **Bridge route (Dioxus)** — `wdio-dioxus-embedded-driver`, a standalone crate the bridge starts automatically when the automation port is set (no explicit app registration beyond installing the bridge). The embedded crate depends on the bridge crate (`wdio-<framework>-bridge = { path = "../<framework>-bridge" }`).

Structure (mirror `packages/dioxus-embedded-driver/`):

```
src/
├── lib.rs
├── server/
│   ├── mod.rs, router.rs, response.rs
│   └── handlers/{session,navigation,element,document,script,screenshot,window,cookie,timeouts,stubs}.rs
└── webdriver/{mod,session,element}.rs
```

WebDriver commands that need DOM/JS access are dispatched into the webview through the in-app IPC channel — the Axum handler enqueues an eval request and waits on a `oneshot` for the guest-js loop to return the result (the bridge-route mechanism described below; the plugin route uses Tauri's invoke bus equivalently).

## In-app plumbing

### If the framework has a plugin system → plugin crate (Tauri)

Tauri registers `tauri-plugin-wdio` (`packages/tauri-plugin/`): `commands.rs` (invoke handlers), `desktop.rs`, `lib.rs`, `models.rs`, plus `guest-js/` injected via the plugin's `build.rs`. Uses Tauri's `tauri-plugin` build machinery and `permissions/`. The app opts in by adding the plugin in `tauri::Builder`.

### If the framework has no plugin system → bridge crate (Dioxus)

Dioxus has no plugin API, so `wdio-<framework>-bridge` wires itself into the framework's `Config` builder. Study `packages/dioxus-bridge/src/lib.rs`:

- `install(config: Config) -> Config` registers a `wdio://` **custom protocol** handler (backed by a `CommandRegistry`) and injects the guest-js bundle into the webview `<head>` via `with_custom_head`, so `window.__WDIO_<FRAMEWORK>__.invoke` exists before app code runs.
- Modules: `automation.rs` (env-var reader), `invoke.rs` (`CommandRegistry` + request handler), `log_bridge.rs` (frontend/backend log forwarding), `window_state.rs` (multi-window registry feeding `switchWindow`/`listWindows`), `embedded.rs` (eval queue bridging the embedded driver), `deeplink.rs`.
- **Gotcha — call `install()` last in the Config chain.** It uses `with_on_window`, which Dioxus stores in a single `Option` with no getter; a later user `with_on_window` silently replaces the bridge hook and breaks multi-window.
- The app guards the call so the bridge never ships in release:
  ```rust
  #[cfg(debug_assertions)]
  { config = wdio_<framework>_bridge::install(config); }
  ```

#### `wdio://` invoke channel + Windows quirk

guest-js POSTs `{command, args}` to the custom protocol and unwraps an `{ok, value?, error?}` envelope. On Windows, Wry doesn't register arbitrary schemes with WebView2 — it intercepts `http://<scheme>.*` instead — so `fetch('wdio://invoke')` is rejected before reaching the handler. The bridge therefore injects `window.__WDIO_BRIDGE_URL__` (`http://wdio.invoke/` on Windows, `wdio://invoke` elsewhere) and guest-js reads that. guest-js omits `Content-Type` so the browser sends `text/plain` — a CORS "simple" request that skips the OPTIONS preflight; the Rust side parses JSON regardless.

## guest-js bundle (bridge path)

Browser-side TS bundled to a single ESM file and embedded into the crate at build time.

- Source: `guest-js/index.ts`; build via `scripts/build-guest-js.ts` (esbuild → `dist-js/index.js`, then `tsc --emitDeclarationOnly` → `dist-js/index.d.ts`). Mirrors `tauri-plugin/scripts/build-guest-js.ts`.
- `build.rs` copies `dist-js/index.js` into `OUT_DIR`; `lib.rs` embeds it with `include_str!`. If the bundle isn't built yet, `build.rs` writes a no-op placeholder so `cargo check` still compiles — rerun `pnpm --filter @wdio/<framework>-bridge build` to repopulate.
- The bundle installs `window.__WDIO_<FRAMEWORK>__.invoke`, wraps `console.*` to forward frontend logs (install exactly once via a sentinel flag — re-wrapping chains the wrappers and amplifies each log), and runs the **embedded-driver polling loop** when `window.__WDIO_EMBEDDED_PORT` is injected (poll → eval via `AsyncFunction` → return result over the same IPC).

## Cargo conventions

- Edition `"2021"`, `rust-version = "1.77.2"`, license `Apache-2.0 OR MIT`, initial version `1.0.0-rc.0`.
- Bridge crate: `with-bridge` feature flag (default off) so release builds compile the bridge to a no-op. Test/CI builds opt in explicitly.
- Lib crate name uses underscores (`wdio_<framework>_bridge`); package/binary use hyphens.
- Root `.gitignore`: `packages/*/target/` and `packages/*/Cargo.lock` (Cargo.lock for these crates is not committed).

## npm ↔ crate version lockstep

The bridge ships as **both** an npm package (the guest-js bundle, `@wdio/<framework>-bridge`, `-next.N` prerelease) **and** a crate (`wdio-<framework>-bridge`, `-rc.N` prerelease). `build.rs` asserts the two agree on core `X.Y.Z` (pre-release suffixes may differ per registry convention) and **panics on mismatch** — bump both together before releasing.

## macOS gotcha — WKWebView background throttling (embedded provider)

On macOS, WKWebView suspends the WebContent process running the JS polling loop when the window is unfocused or the app is napping — fatal on a headless CI runner, where the loop silently freezes and WebDriver commands time out. Mitigation that landed for Dioxus:

- The service sets `<FRAMEWORK>_WEBVIEW_AUTOMATION=true` on the app process (external path: in the driver's `webdriver.rs`; embedded path: in the service's embedded provider, since there's no driver subprocess — see `dioxus-service/src/providers/embedded.ts`).
- Under that flag the **app** disables `with_background_throttling` (the fix lives at app level, gated behind a Cargo feature — not in the bridge). Earlier attempts at a JS keepalive (silent AudioContext, then a muted `HTMLAudioElement`) were superseded by the app-level toggle.

Treat this as the canonical "embedded loop goes quiet on macOS CI" diagnosis.
