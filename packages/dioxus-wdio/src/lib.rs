//! Connects a Dioxus desktop app to [`@wdio/dioxus-service`] so WebdriverIO
//! can test it.
//!
//! ```ignore
//! fn main() {
//!     let mut config = dioxus::desktop::Config::new();
//!     #[cfg(debug_assertions)]
//!     {
//!         config = wdio_dioxus::install(config);
//!     }
//!     dioxus::LaunchBuilder::desktop().with_cfg(config).launch(App);
//! }
//! ```
//!
//! [`install`] does nothing unless the service launched the app. When it did,
//! it installs [`wdio-dioxus-bridge`] and starts the in-app WebDriver server
//! from [`wdio-dioxus-embedded-driver`].
//!
//! [`@wdio/dioxus-service`]: https://www.npmjs.com/package/@wdio/dioxus-service
//! [`wdio-dioxus-bridge`]: https://docs.rs/wdio-dioxus-bridge
//! [`wdio-dioxus-embedded-driver`]: https://docs.rs/wdio-dioxus-embedded-driver

use std::sync::Arc;

use dioxus_core::VirtualDom;
use dioxus_desktop::{tao::window::Window, Config};

pub use wdio_dioxus_bridge::{automation, deeplink, CommandRegistry};

// Set to `external` by `wdio-dioxus-driver`.
const PROVIDER_ENV_VAR: &str = "WDIO_DIOXUS_PROVIDER";

/// Installs WDIO support into a Dioxus [`Config`]. Does nothing unless
/// `@wdio/dioxus-service` launched the app.
///
/// Call it last in your `Config` chain: a later `with_on_window` or
/// `with_custom_head` call replaces the bridge's.
#[must_use]
pub fn install(config: Config) -> Config {
  install_with_commands(config, |_| {})
}

/// Like [`install`], but also registers app commands that tests can call.
///
/// ```ignore
/// config = wdio_dioxus::install_with_commands(config, |registry| {
///     registry.register("get_version", |_args| Ok(serde_json::json!("1.2.3")));
/// });
/// ```
#[must_use]
pub fn install_with_commands<F: FnOnce(&CommandRegistry)>(config: Config, register: F) -> Config {
  let external_provider =
    std::env::var(PROVIDER_ENV_VAR).is_ok_and(|provider| provider == "external");
  match mode(automation::is_requested(), external_provider) {
    Mode::Off => config,
    Mode::Embedded => install_embedded(config, register),
    Mode::BridgeOnly => install_bridge(config, register),
  }
}

/// Registers a window with WDIO, for apps that set their own `with_on_window`
/// callback. Set it after [`install`], which it replaces, and call this from it:
///
/// ```ignore
/// config = config.with_on_window(|window, dom| {
///     // the app's own window setup
///     #[cfg(debug_assertions)]
///     wdio_dioxus::on_window(&window, dom);
/// });
/// ```
pub fn on_window(window: &Arc<Window>, dom: &mut VirtualDom) {
  // Unused for now; it's in the signature so native webview calls can use it without an API change.
  let _ = dom;
  if automation::is_requested() {
    wdio_dioxus_bridge::window_state::register_window(window);
  }
}

/// Returns the `<head>` `<script>` snippet that [`install`] injects when
/// `@wdio/dioxus-service` launched the app, or an empty string otherwise.
///
/// For apps that set their own [`Config::with_custom_head`]: call it after
/// [`install`], which it replaces, and append this snippet to your head HTML:
///
/// ```ignore
/// let mut head = r#"<link rel="stylesheet" href="/assets/main.css">"#.to_string();
/// #[cfg(debug_assertions)]
/// head.push_str(&wdio_dioxus::custom_head());
/// config = config.with_custom_head(head);
/// ```
#[must_use]
pub fn custom_head() -> String {
  let external_provider =
    std::env::var(PROVIDER_ENV_VAR).is_ok_and(|provider| provider == "external");
  custom_head_for_mode(mode(automation::is_requested(), external_provider))
}

fn custom_head_for_mode(mode: Mode) -> String {
  match mode {
    Mode::Off => String::new(),
    Mode::Embedded => embedded_custom_head(),
    Mode::BridgeOnly => wdio_dioxus_bridge::custom_head(),
  }
}

#[derive(Debug, PartialEq, Eq)]
enum Mode {
  Off,
  Embedded,
  BridgeOnly,
}

fn mode(automation_requested: bool, external_provider: bool) -> Mode {
  match (automation_requested, external_provider) {
    (false, _) => Mode::Off,
    (true, false) => Mode::Embedded,
    (true, true) => Mode::BridgeOnly,
  }
}

#[cfg(feature = "embedded")]
fn install_embedded<F: FnOnce(&CommandRegistry)>(config: Config, register: F) -> Config {
  wdio_dioxus_embedded_driver::install_with_commands(config, register)
}

#[cfg(not(feature = "embedded"))]
fn install_embedded<F: FnOnce(&CommandRegistry)>(config: Config, register: F) -> Config {
  install_bridge(config, register)
}

#[cfg(feature = "embedded")]
fn embedded_custom_head() -> String {
  let port = std::env::var(wdio_dioxus_embedded_driver::PORT_ENV_VAR)
    .ok()
    .and_then(|s| s.parse::<u16>().ok())
    .unwrap_or(wdio_dioxus_embedded_driver::DEFAULT_PORT);
  wdio_dioxus_bridge::custom_head_with_embedded_port(port)
}

#[cfg(not(feature = "embedded"))]
fn embedded_custom_head() -> String {
  wdio_dioxus_bridge::custom_head()
}

fn install_bridge<F: FnOnce(&CommandRegistry)>(config: Config, register: F) -> Config {
  let registry = CommandRegistry::new();
  register(&registry);
  wdio_dioxus_bridge::install_with_registry(config, registry)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn should_do_nothing_when_not_launched_by_the_service() {
    assert_eq!(mode(false, false), Mode::Off);
    assert_eq!(mode(false, true), Mode::Off);
  }

  #[test]
  fn should_start_the_embedded_server_by_default() {
    assert_eq!(mode(true, false), Mode::Embedded);
  }

  #[test]
  fn should_install_only_the_bridge_for_the_external_provider() {
    assert_eq!(mode(true, true), Mode::BridgeOnly);
  }

  #[test]
  fn custom_head_is_empty_when_automation_is_off() {
    assert_eq!(custom_head_for_mode(Mode::Off), "");
  }

  #[test]
  fn custom_head_returns_bridge_head_for_external_provider() {
    let head = custom_head_for_mode(Mode::BridgeOnly);
    assert!(head.contains("window.__WDIO_BRIDGE_URL__="));
    assert!(!head.contains("window.__WDIO_EMBEDDED_PORT="));
  }

  #[cfg(feature = "embedded")]
  #[test]
  fn custom_head_includes_embedded_port_in_embedded_mode() {
    let head = custom_head_for_mode(Mode::Embedded);
    assert!(head.contains("window.__WDIO_BRIDGE_URL__="));
    assert!(head.contains("window.__WDIO_EMBEDDED_PORT="));
  }
}
