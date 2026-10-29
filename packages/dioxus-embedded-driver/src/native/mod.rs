//! Native webview calls, made on the main thread through
//! [`wdio_dioxus_bridge::webview`].

use std::time::Duration;

use tokio::sync::oneshot;

use crate::server::response::WebDriverErrorResponse;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
use linux as platform;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
use macos as platform;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
use windows as platform;

/// Sends one result back from the main thread, however many times the native
/// completion handler fires.
pub(crate) type Reply<T> = oneshot::Sender<Result<T, String>>;

/// Captures the visible page of the window labelled `label` as a base64 PNG.
#[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
pub async fn screenshot(label: &str, timeout: Duration) -> Result<String, WebDriverErrorResponse> {
  let (tx, rx) = oneshot::channel();
  let queued = wdio_dioxus_bridge::webview::run_on_main_thread(
    label,
    Box::new(move |desktop| platform::take_screenshot(desktop, tx)),
  );
  if !queued {
    return Err(WebDriverErrorResponse::no_such_window());
  }
  match tokio::time::timeout(timeout, rx).await {
    Ok(Ok(Ok(png_base64))) => Ok(png_base64),
    Ok(Ok(Err(message))) => Err(WebDriverErrorResponse::unknown_error(&message)),
    Ok(Err(_)) => {
      Err(WebDriverErrorResponse::unknown_error("the webview dropped the screenshot request"))
    }
    Err(_) => Err(WebDriverErrorResponse::script_timeout()),
  }
}

/// A 1×1 transparent PNG, returned where native capture isn't wired yet.
#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
pub async fn screenshot(
  _label: &str,
  _timeout: Duration,
) -> Result<String, WebDriverErrorResponse> {
  Ok("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==".to_string())
}
