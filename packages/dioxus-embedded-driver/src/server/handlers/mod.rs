use std::sync::Arc;

use axum::extract::State;
use serde_json::json;

use crate::server::response::{WebDriverResponse, WebDriverResult};
use crate::server::AppState;

pub mod cookie;
pub mod document;
pub mod element;
pub mod navigation;
pub mod screenshot;
pub mod script;
pub mod session;
pub mod stubs;
pub mod timeouts;
pub mod window;

/// GET `/status` — returns ready=true when the bridge has at least one
/// registered window (indicating the webview is up and the IPC channel is
/// ready for commands).
pub async fn status(State(state): State<Arc<AppState>>) -> WebDriverResult {
  let labels = state.list_windows();
  let ready = !labels.is_empty();
  Ok(WebDriverResponse::success(json!({
    "ready": ready,
    "message": if ready { "wdio-dioxus-embedded-driver is ready" } else { "waiting for webview" }
  })))
}
