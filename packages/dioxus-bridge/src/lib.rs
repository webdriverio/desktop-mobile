//! `wdio-dioxus-bridge` — bridge crate consumed by Dioxus desktop apps that
//! want to be testable via `@wdio/dioxus-service`.
//!
//! Ships the automation env-var reader ([`automation`]), the `wdio://invoke`
//! IPC channel ([`invoke`]), frontend/backend log forwarding
//! ([`log_bridge`]), a multi-window registry ([`window_state`]) that
//! auto-labels Dioxus windows for [`@wdio/dioxus-service`]'s `switchWindow`
//! / `listWindows` APIs, and an optional deeplink reference helper
//! ([`deeplink`]) for apps that want to wire `Config::with_custom_protocol`
//! with one line.
//!
//! # Quick start
//!
//! Add to `Cargo.toml`:
//! ```toml
//! [dependencies.wdio-dioxus-bridge]
//! version = "1"
//! features = ["with-bridge"]
//! ```
//!
//! Wire into your `main.rs`, guarded for debug builds so the bridge never
//! ships in release:
//!
//! ```ignore
//! fn main() {
//!     let mut config = dioxus::desktop::Config::new();
//!     #[cfg(debug_assertions)]
//!     {
//!         config = wdio_dioxus_bridge::install(config);
//!     }
//!     dioxus::LaunchBuilder::desktop().with_cfg(config).launch(App);
//! }
//! ```
//!
//! [`@wdio/dioxus-service`]: https://www.npmjs.com/package/@wdio/dioxus-service
//!
//! # Multi-window note
//!
//! [`install`] calls [`Config::with_on_window`] to feed each newly-built
//! window into the window-state registry. Dioxus stores the on-window
//! callback in an `Option` with no getter, so a subsequent
//! `config.with_on_window(...)` call by user code would silently replace
//! the bridge's hook and break multi-window support. **Call
//! `wdio_dioxus_bridge::install(config)` last in your Config builder
//! chain**, or invoke [`window_state::register_window`] from your own
//! on-window callback.

pub mod automation;
pub mod deeplink;
pub mod embedded;
pub mod invoke;
pub mod log_bridge;
pub mod window_state;

use dioxus_desktop::Config;
use serde_json::{json, Value};

pub use invoke::CommandRegistry;
pub use log_bridge::FRONTEND_MARKER;

/// The bundled `@wdio/dioxus-bridge` guest-js — populated at build time by
/// `build.rs` from `guest-js/dist-js/index.js`. When the bundle hasn't been
/// built yet, the placeholder is a no-op comment and the bridge silently
/// degrades to "no JS injected"; rerun `pnpm --filter @wdio/dioxus-bridge
/// build` to repopulate.
const GUEST_JS_BUNDLE: &str = include_str!(concat!(env!("OUT_DIR"), "/guest_js_bundle.js"));

/// Install the WDIO bridge into a Dioxus [`Config`]:
///
/// 1. Reports the [`automation`] env-var state via tracing.
/// 2. Registers the `wdio://` custom protocol handler backed by a fresh
///    [`CommandRegistry`] (with the built-in `__ping` command).
/// 3. Injects the `@wdio/dioxus-bridge` guest-js bundle into the webview's
///    document `<head>` so `window.__WDIO_DIOXUS__.invoke` is available
///    before any app code runs.
/// 4. Returns the [`Config`] for chainability with the app's own builders.
pub fn install(config: Config) -> Config {
  install_with_registry(config, CommandRegistry::new())
}

/// Variant of [`install`] that accepts a pre-populated [`CommandRegistry`].
/// Use this when the app needs custom commands beyond the built-ins.
pub fn install_with_registry(config: Config, registry: CommandRegistry) -> Config {
  install_with_registry_and_config(config, registry, None)
}

/// Variant of [`install_with_registry`] that also signals the embedded
/// WebDriver port to the guest-js bundle. Called by
/// `wdio-dioxus-embedded-driver` so the JS polling loop knows which port is
/// active without requiring a separate environment variable read in JS.
pub fn install_with_embedded_port(config: Config, port: u16) -> Config {
  embedded::init();
  install_with_registry_and_config(config, CommandRegistry::new(), Some(port))
}

fn install_with_registry_and_config(
  config: Config,
  registry: CommandRegistry,
  embedded_port: Option<u16>,
) -> Config {
  automation::report();
  log_bridge::register(&registry);
  register_window_commands(&registry);
  if embedded_port.is_some() {
    register_embedded_commands(&registry);
  }

  let registry_for_handler = registry;

  // If the embedded driver is active, inject the port signal before the
  // module script so the polling loop starts up automatically.
  let head = match embedded_port {
    Some(port) => format!(
      "<script>window.__WDIO_EMBEDDED_PORT={};</script><script type=\"module\">{GUEST_JS_BUNDLE}</script>",
      port
    ),
    None => format!("<script type=\"module\">{GUEST_JS_BUNDLE}</script>"),
  };

  config
    .with_custom_protocol("wdio".to_string(), move |_webview_id, request| {
      invoke::handle_invoke_request(&registry_for_handler, &request)
    })
    .with_custom_head(head)
    .with_on_window(|window, _dom| {
      let label = window_state::register_window(&window);
      tracing::debug!(label = %label, "wdio-dioxus-bridge: registered window");
    })
}

fn register_window_commands(registry: &CommandRegistry) {
  registry.register("__list_windows", |_args| Ok(json!(window_state::list_labels())));
  registry.register("__active_window", |_args| {
    Ok(json!(window_state::get_active_label()))
  });
  registry.register("__window_states", |_args| {
    Ok(json!(window_state::get_window_states()))
  });
}

fn register_embedded_commands(registry: &CommandRegistry) {
  // __embedded_poll — non-blocking: returns the next pending eval request or
  // null. Called by the guest-js polling loop every ~10 ms when the embedded
  // driver is active.
  registry.register("__embedded_poll", |_args| {
    match embedded::poll_next() {
      Some((id, script, args)) => Ok(json!({ "id": id, "script": script, "args": args })),
      None => Ok(Value::Null),
    }
  });

  // __embedded_result — receives the JS-evaluated result for a previously
  // polled request and delivers it to the waiting Axum handler.
  registry.register("__embedded_result", |args| {
    let id = args["id"].as_str().ok_or("missing id")?.to_string();
    let result = match args["error"].as_str() {
      Some(err) => Err(err.to_string()),
      None => Ok(args["result"].clone()),
    };
    embedded::resolve(&id, result);
    Ok(Value::Null)
  });
}
