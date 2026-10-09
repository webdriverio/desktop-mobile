//! `wdio-dioxus-embedded-driver` — in-process WebDriver HTTP server for
//! Dioxus desktop apps.
//!
//! Instead of requiring an external WebDriver binary (like msedgedriver or
//! WebKitWebDriver), this crate starts an Axum-based WebDriver HTTP server
//! *inside* the Dioxus app process. Commands are routed to the webview
//! through `wdio-dioxus-bridge`'s existing IPC channel — the guest-js bundle
//! runs a polling loop that picks up eval requests, executes them, and posts
//! results back. No native webview handle is needed.
//!
//! # Usage
//!
//! ```ignore
//! fn main() {
//!     let mut config = dioxus::desktop::Config::new();
//!     #[cfg(debug_assertions)]
//!     {
//!         config = wdio_dioxus_embedded_driver::install(config);
//!     }
//!     dioxus::LaunchBuilder::desktop().with_cfg(config).launch(App);
//! }
//! ```
//!
//! [`install`] does nothing unless `DIOXUS_WEBVIEW_AUTOMATION=true`, so
//! everyday debug runs don't start the server. `@wdio/dioxus-service` sets it,
//! along with the port in `WDIO_EMBEDDED_PORT` (default 4444).

pub mod server;
pub mod webdriver;

use dioxus_desktop::Config;

/// Re-export the bridge's `automation` module so apps using only
/// `wdio-dioxus-embedded-driver` can gate code on the WDIO automation
/// env var without adding a separate dep on `wdio-dioxus-bridge`.
pub use wdio_dioxus_bridge::automation;

/// Default port for the embedded WebDriver HTTP server.
pub const DEFAULT_PORT: u16 = 4444;

/// Environment variable the service uses to communicate the port.
pub const PORT_ENV_VAR: &str = "WDIO_EMBEDDED_PORT";

/// Install the embedded WebDriver server into a Dioxus [`Config`].
///
/// This also installs the `wdio-dioxus-bridge` (IPC channel + guest-js
/// injection), wiring the polling loop that makes script execution work.
/// Call this **last** in your `Config` builder chain so the bridge's
/// `with_on_window` hook isn't shadowed by subsequent calls.
///
/// Returns `config` unchanged unless the app is running under
/// `@wdio/dioxus-service` (see [`automation::is_requested`]).
#[must_use]
pub fn install(config: Config) -> Config {
  install_with_commands(config, |_| {})
}

/// Like [`install`] but calls `register` with a fresh
/// [`CommandRegistry`](wdio_dioxus_bridge::CommandRegistry)
/// so the app can add custom commands before the bridge is wired up.
///
/// # Example
/// ```ignore
/// config = wdio_dioxus_embedded_driver::install_with_commands(config, |registry| {
///     registry.register("ping_app", |_| Ok(serde_json::json!("pong")));
/// });
/// ```
#[must_use]
pub fn install_with_commands<F: FnOnce(&wdio_dioxus_bridge::CommandRegistry)>(
  config: Config,
  register: F,
) -> Config {
  if !automation::is_requested() {
    tracing::debug!("not running under @wdio/dioxus-service; wdio-dioxus-embedded-driver not started");
    return config;
  }

  let port = std::env::var(PORT_ENV_VAR)
    .ok()
    .and_then(|s| s.parse::<u16>().ok())
    .unwrap_or(DEFAULT_PORT);

  // Use a port-scoped temp directory so concurrent instances (multiremote)
  // each get their own WebView2/WebKit user data folder and don't conflict.
  let data_dir = std::env::temp_dir().join(format!("wdio-dioxus-{port}"));
  let config = config.with_data_directory(data_dir);

  let registry = wdio_dioxus_bridge::CommandRegistry::new();
  register(&registry);
  let config = wdio_dioxus_bridge::install_with_embedded_port_and_registry(config, registry, port);
  server::start(port);
  tracing::info!(port, "wdio-dioxus-embedded-driver started");
  config
}
