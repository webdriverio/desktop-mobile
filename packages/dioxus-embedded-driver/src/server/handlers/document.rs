use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Path, State};
use tokio::sync::oneshot;
use uuid::Uuid;

use crate::server::response::{WebDriverErrorResponse, WebDriverResponse, WebDriverResult};
use crate::server::AppState;

/// GET `/session/{session_id}/source`
pub async fn get_source(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
) -> WebDriverResult {
  let timeout = {
    let sessions = state.sessions.read().await;
    sessions.get(&session_id)?.timeouts.script_ms
  };
  let (tx, rx) = oneshot::channel();
  let id = Uuid::new_v4().to_string();
  wdio_dioxus_bridge::embedded::push(
    id,
    "document.documentElement.outerHTML".to_string(),
    vec![],
    tx,
  );
  match tokio::time::timeout(Duration::from_millis(timeout), rx).await {
    Ok(Ok(Ok(v))) => Ok(WebDriverResponse::success(v)),
    Ok(Ok(Err(e))) => Err(WebDriverErrorResponse::javascript_error(&e, None)),
    _ => Err(WebDriverErrorResponse::script_timeout()),
  }
}
