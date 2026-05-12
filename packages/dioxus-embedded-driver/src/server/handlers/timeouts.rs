use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::server::response::{WebDriverResponse, WebDriverResult};
use crate::server::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeoutsResponse {
  pub implicit: u64,
  pub page_load: u64,
  pub script: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetTimeoutsRequest {
  pub implicit: Option<u64>,
  pub page_load: Option<u64>,
  pub script: Option<u64>,
}

/// GET `/session/{session_id}/timeouts`
pub async fn get(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
) -> WebDriverResult {
  let sessions = state.sessions.read().await;
  let session = sessions.get(&session_id)?;
  Ok(WebDriverResponse::success(json!({
    "implicit": session.timeouts.implicit_ms,
    "pageLoad": session.timeouts.page_load_ms,
    "script": session.timeouts.script_ms,
  })))
}

/// POST `/session/{session_id}/timeouts`
pub async fn set(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
  Json(req): Json<SetTimeoutsRequest>,
) -> WebDriverResult {
  let mut sessions = state.sessions.write().await;
  let session = sessions.get_mut(&session_id)?;
  if let Some(v) = req.implicit { session.timeouts.implicit_ms = v; }
  if let Some(v) = req.page_load { session.timeouts.page_load_ms = v; }
  if let Some(v) = req.script { session.timeouts.script_ms = v; }
  Ok(WebDriverResponse::null())
}
