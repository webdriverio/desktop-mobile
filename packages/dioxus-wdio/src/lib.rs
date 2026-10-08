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

use dioxus_desktop::Config;

pub use wdio_dioxus_bridge::{automation, deeplink, window_state, CommandRegistry};

/// Set to `external` by `wdio-dioxus-driver`, which drives the app from
/// outside, so the app needs the bridge but not its own WebDriver server.
const PROVIDER_ENV_VAR: &str = "WDIO_DIOXUS_PROVIDER";

/// Installs WDIO support into a Dioxus [`Config`]. Does nothing unless
/// `@wdio/dioxus-service` launched the app.
///
/// Call it last in your `Config` chain: Dioxus keeps one `with_on_window`
/// callback and one custom head, and a later call replaces the bridge's.
#[must_use]
pub fn install(config: Config) -> Config {
  install_with_commands(config, |_| {})
}

/// Like [`install`], but registers the app's own commands first. Tests call
/// them with `browser.dioxus.execute(({ invoke }) => invoke('name'))`.
///
/// ```ignore
/// config = wdio_dioxus::install_with_commands(config, |registry| {
///     registry.register("get_version", |_args| Ok(serde_json::json!("1.2.3")));
/// });
/// ```
#[must_use]
pub fn install_with_commands<F: FnOnce(&CommandRegistry)>(config: Config, register: F) -> Config {
  let external_provider = std::env::var(PROVIDER_ENV_VAR).is_ok_and(|provider| provider == "external");
  match mode(automation::is_requested(), external_provider) {
    Mode::Off => config,
    Mode::Embedded => install_embedded(config, register),
    Mode::BridgeOnly => install_bridge(config, register),
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
}
