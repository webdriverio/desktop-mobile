//! `wdio-dioxus-bridge` — bridge crate consumed by Dioxus desktop apps that
//! want to be testable via `@wdio/dioxus-service`.
//!
//! v1 ships only the automation env-var reader ([`automation`]). The full
//! bridge IPC (`wdio://` custom protocol + invoke command bus + log forwarder
//! + guest-js bundle) lands in Phase 2 of the dioxus-service rollout.
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

use dioxus_desktop::Config;

/// Install the WDIO bridge into a Dioxus [`Config`]. Reads
/// `DIOXUS_WEBVIEW_AUTOMATION` (set by `@wdio/dioxus-service` when spawning
/// the app under test) and logs whether automation was requested.
///
/// **v1 limitation:** Dioxus's public Config API has no hook to flip Wry's
/// automation mode on Linux (see `spike/FINDINGS.md`). This function logs the
/// detected env-var state but cannot itself enable WebKitWebDriver attach.
/// Provider `'external'` is consequently Windows-only in v1; Linux users are
/// directed to `provider: 'embedded'` by the launcher.
///
/// Returns the (currently unmodified) [`Config`] for chainability with future
/// Phase 2 builders.
pub fn install(config: Config) -> Config {
  automation::report();
  config
}
