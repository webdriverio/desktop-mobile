//! `wdio-dioxus-bridge` — bridge crate consumed by Dioxus desktop apps that
//! want to be testable via `@wdio/dioxus-service`.
//!
//! Ships the automation env-var reader ([`automation`]), the `wdio://invoke`
//! IPC channel ([`invoke`]), frontend/backend log forwarding
//! ([`log_bridge`]), and a multi-window registry ([`window_state`]) that
//! auto-labels Dioxus windows for [`@wdio/dioxus-service`]'s `switchWindow`
//! / `listWindows` APIs. Subsequent milestones add the deeplink reference
//! handler.
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
pub mod invoke;
pub mod log_bridge;
pub mod window_state;

use dioxus_desktop::Config;
use serde_json::json;

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
  automation::report();
  log_bridge::register(&registry);
  register_window_commands(&registry);

  let registry_for_handler = registry;
  config
    .with_custom_protocol("wdio".to_string(), move |_webview_id, request| {
      invoke::handle_invoke_request(&registry_for_handler, &request)
    })
    .with_custom_head(format!(
      "<script type=\"module\">{GUEST_JS_BUNDLE}</script>"
    ))
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
