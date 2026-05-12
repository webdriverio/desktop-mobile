use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use serde::Deserialize;
use serde_json::json;

use crate::server::response::{WebDriverErrorResponse, WebDriverResponse, WebDriverResult};
use crate::server::AppState;

/// GET `/session/{session_id}/window` — current window handle.
pub async fn get_window_handle(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
) -> WebDriverResult {
  let sessions = state.sessions.read().await;
  let session = sessions.get(&session_id)?;
  Ok(WebDriverResponse::success(&session.current_window))
}

/// GET `/session/{session_id}/window/handles` — all window handles.
pub async fn get_window_handles(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
) -> WebDriverResult {
  let sessions = state.sessions.read().await;
  let _ = sessions.get(&session_id)?; // validate session exists
  let labels = wdio_dioxus_bridge::window_state::list_labels();
  Ok(WebDriverResponse::success(labels))
}

#[derive(Debug, Deserialize)]
pub struct SwitchWindowRequest {
  pub handle: String,
}

/// POST `/session/{session_id}/window` — switch to a window by label.
///
/// The embedded driver routes all IPC through a single shared channel; it has
/// no per-window dispatch. Updating `current_window` would not redirect
/// subsequent commands to the target webview, so this returns an unsupported
/// error rather than silently executing commands in the wrong window.
/// Per-window IPC routing requires a bridge-level change outside this driver.
pub async fn switch_to_window(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
  Json(req): Json<SwitchWindowRequest>,
) -> WebDriverResult {
  let sessions = state.sessions.read().await;
  let _ = sessions.get(&session_id)?;
  drop(sessions);
  let labels = wdio_dioxus_bridge::window_state::list_labels();
  if !labels.contains(&req.handle) {
    return Err(WebDriverErrorResponse::no_such_window());
  }
  Err(WebDriverErrorResponse::unsupported_operation(
    "window switching is not supported by the embedded driver: the IPC channel is not per-window. Use browser.dioxus.switchWindow() instead, which routes through the bridge.",
  ))
}

/// DELETE `/session/{session_id}/window` — close the current window.
pub async fn close_window(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
) -> WebDriverResult {
  let sessions = state.sessions.read().await;
  let _ = sessions.get(&session_id)?;
  // In a Dioxus app, window closing is application-controlled, not driver-
  // controlled. Return the remaining window list as required by W3C spec.
  let remaining = wdio_dioxus_bridge::window_state::list_labels();
  Ok(WebDriverResponse::success(remaining))
}

/// GET `/session/{session_id}/window/rect`
pub async fn get_rect(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
) -> WebDriverResult {
  let sessions = state.sessions.read().await;
  let _ = sessions.get(&session_id)?;
  Ok(WebDriverResponse::success(json!({ "x": 0, "y": 0, "width": 0, "height": 0 })))
}

#[derive(Debug, Deserialize)]
pub struct SetRectRequest {
  pub x: Option<i32>,
  pub y: Option<i32>,
  pub width: Option<u32>,
  pub height: Option<u32>,
}

/// POST `/session/{session_id}/window/rect`
pub async fn set_rect(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
  Json(req): Json<SetRectRequest>,
) -> WebDriverResult {
  let sessions = state.sessions.read().await;
  let _ = sessions.get(&session_id)?;
  Ok(WebDriverResponse::success(json!({
    "x": req.x.unwrap_or(0),
    "y": req.y.unwrap_or(0),
    "width": req.width.unwrap_or(0),
    "height": req.height.unwrap_or(0),
  })))
}

/// POST `/session/{session_id}/window/maximize`
pub async fn maximize(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
) -> WebDriverResult {
  let sessions = state.sessions.read().await;
  let _ = sessions.get(&session_id)?;
  Ok(WebDriverResponse::success(json!({ "x": 0, "y": 0, "width": 0, "height": 0 })))
}

/// POST `/session/{session_id}/window/minimize`
pub async fn minimize(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
) -> WebDriverResult {
  let sessions = state.sessions.read().await;
  let _ = sessions.get(&session_id)?;
  Ok(WebDriverResponse::success(json!({ "x": 0, "y": 0, "width": 0, "height": 0 })))
}

/// POST `/session/{session_id}/window/fullscreen`
pub async fn fullscreen(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
) -> WebDriverResult {
  let sessions = state.sessions.read().await;
  let _ = sessions.get(&session_id)?;
  Ok(WebDriverResponse::success(json!({ "x": 0, "y": 0, "width": 0, "height": 0 })))
}
