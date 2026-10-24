use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Path, State};

use crate::server::response::{WebDriverResponse, WebDriverResult};
use crate::server::AppState;

/// GET `/session/{session_id}/screenshot`
///
/// Captures the current window's visible page natively on the main thread
/// (WKWebView snapshot on macOS, WebView2 `CapturePreview` on Windows).
pub async fn take(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
) -> WebDriverResult {
  let (label, timeout_ms) = {
    let sessions = state.sessions.read().await;
    let session = sessions.get(&session_id)?;
    (session.current_window.clone(), session.timeouts.script_ms)
  };

  let png_base64 = crate::native::screenshot(&label, Duration::from_millis(timeout_ms)).await?;
  Ok(WebDriverResponse::success(png_base64))
}
