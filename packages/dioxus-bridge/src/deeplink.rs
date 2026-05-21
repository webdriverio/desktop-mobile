//! Optional reference helper for registering an in-app deeplink handler.
//!
//! `@wdio/dioxus-service`'s `browser.dioxus.triggerDeeplink(url)` works at
//! the OS level — it spawns `rundll32` / `open` / `gio open` so the OS
//! routes the URL to whichever app has registered as the protocol handler.
//! That's the most realistic test of the production code path.
//!
//! Apps still need to actually *handle* the deeplink when it arrives. This
//! module is a thin convenience for that side: [`register_handler`] wraps
//! [`dioxus_desktop::Config::with_custom_protocol`] to capture the URL and
//! dispatch it into the running app via the user-supplied callback.
//!
//! Apps that already register a custom protocol handler — common, since
//! deeplink wiring is application logic — can ignore this module entirely;
//! it's published purely as documentation-by-example.
//!
//! # Example
//!
//! ```ignore
//! use wdio_dioxus_bridge::deeplink;
//!
//! fn main() {
//!     let mut config = dioxus_desktop::Config::new();
//!     config = deeplink::register_handler(config, "myapp", |url| {
//!         tracing::info!("deeplink received: {url}");
//!         // forward into the app's state, dispatch a signal, etc.
//!     });
//!     #[cfg(debug_assertions)]
//!     {
//!         config = wdio_dioxus_bridge::install(config);
//!     }
//!     dioxus::LaunchBuilder::desktop().with_cfg(config).launch(App);
//! }
//! ```

use std::borrow::Cow;
use std::sync::Arc;

use dioxus_desktop::wry::http::{HeaderValue, Response, StatusCode};
use dioxus_desktop::Config;

/// Register a deeplink handler for the given URI scheme. The supplied
/// callback fires every time the OS dispatches a `<scheme>://...` URL to
/// the app. Returns the [`Config`] for chainability.
///
/// The HTTP response sent back is a 200 with an empty body — Wry expects
/// the custom-protocol handler to return *something*; we return the
/// minimum so the OS doesn't see a navigation error.
pub fn register_handler<F>(config: Config, scheme: impl Into<String>, on_url: F) -> Config
where
  F: Fn(&str) + Send + Sync + 'static,
{
  let cb = Arc::new(on_url);
  config.with_custom_protocol(scheme.into(), move |_webview_id, request| {
    let url = request.uri().to_string();
    cb(&url);
    let mut response = Response::new(Cow::Borrowed(b"" as &[u8]));
    *response.status_mut() = StatusCode::OK;
    response
      .headers_mut()
      .insert("content-type", HeaderValue::from_static("text/plain"));
    response
  })
}
