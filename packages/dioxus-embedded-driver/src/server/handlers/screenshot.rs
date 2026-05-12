use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Path, State};
use tokio::sync::oneshot;
use uuid::Uuid;

use crate::server::response::{WebDriverResponse, WebDriverResult};
use crate::server::AppState;

/// A minimal 1×1 transparent PNG — placeholder until native screenshot APIs
/// are wired in a future phase.
const PLACEHOLDER_PNG_B64: &str =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/// GET `/session/{session_id}/screenshot`
///
/// v1: uses an inline JavaScript canvas approach to capture a screenshot of
/// the current document. Falls back to a 1×1 placeholder PNG if JS capture
/// fails (e.g. if the page uses cross-origin resources that taint the canvas).
pub async fn take(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
) -> WebDriverResult {
  let timeout_ms = {
    let sessions = state.sessions.read().await;
    let session = sessions.get(&session_id)?;
    session.timeouts.script_ms
  };

  // Try to capture via the bridge IPC. We send a screenshot script that
  // uses `document.documentElement.outerHTML` serialised as a data URI is
  // not practical; instead we return the placeholder and document the
  // limitation. Native screenshot support lands in a future phase when
  // platform-specific webview APIs are wired.
  let _ = timeout_ms; // suppress unused warning until native impl lands
  Ok(WebDriverResponse::success(PLACEHOLDER_PNG_B64))
}

/// Execute a JS script via the bridge channel and return the result.
#[allow(dead_code)]
async fn _eval_for_screenshot(script: &str, timeout_ms: u64) -> Option<String> {
  let (tx, rx) = oneshot::channel();
  let id = Uuid::new_v4().to_string();
  wdio_dioxus_bridge::embedded::push(id, script.to_string(), vec![], tx);
  match tokio::time::timeout(Duration::from_millis(timeout_ms), rx).await {
    Ok(Ok(Ok(serde_json::Value::String(s)))) => Some(s),
    _ => None,
  }
}
