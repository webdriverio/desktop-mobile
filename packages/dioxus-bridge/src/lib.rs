//! `wdio-dioxus-bridge` — bridge crate consumed by Dioxus desktop apps that
//! want to be testable via `@wdio/dioxus-service`.
//!
//! v1 ships the automation env-var reader ([`automation`]) and the
//! `wdio://invoke` IPC channel ([`invoke`]). Subsequent milestones will add
//! `log_bridge.rs` (frontend/backend log forwarding via the bridge), window
//! state tracking, and the deeplink reference handler.
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

pub mod automation;
pub mod invoke;

use dioxus_desktop::Config;

pub use invoke::CommandRegistry;

/// Install the WDIO bridge into a Dioxus [`Config`]:
///
/// 1. Reports the [`automation`] env-var state via tracing.
/// 2. Registers a `wdio://` custom protocol handler backed by a fresh
///    [`CommandRegistry`] (with the built-in `__ping` command).
/// 3. Returns the [`Config`] for chainability with the app's own builders.
///
/// To register additional commands, call [`install_with_registry`] instead
/// and pre-populate the registry before passing it in.
pub fn install(config: Config) -> Config {
  install_with_registry(config, CommandRegistry::new())
}

/// Variant of [`install`] that accepts a pre-populated [`CommandRegistry`].
/// Use this when the app needs custom commands beyond the built-ins.
pub fn install_with_registry(config: Config, registry: CommandRegistry) -> Config {
  automation::report();

  let registry_for_handler = registry;
  config.with_custom_protocol("wdio".to_string(), move |_webview_id, request| {
    invoke::handle_invoke_request(&registry_for_handler, &request)
  })
}
