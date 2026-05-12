use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Path, State};
use axum::Json;
use serde::Deserialize;
use serde_json::Value;
use tokio::sync::oneshot;
use uuid::Uuid;

use crate::server::response::{WebDriverResponse, WebDriverResult};
use crate::server::AppState;

async fn eval(script: String, timeout_ms: u64) -> Result<Value, crate::server::response::WebDriverErrorResponse> {
  let (tx, rx) = oneshot::channel();
  let id = Uuid::new_v4().to_string();
  wdio_dioxus_bridge::embedded::push(id, script, vec![], tx);
  match tokio::time::timeout(Duration::from_millis(timeout_ms), rx).await {
    Ok(Ok(Ok(v))) => Ok(v),
    Ok(Ok(Err(e))) => Err(crate::server::response::WebDriverErrorResponse::javascript_error(&e, None)),
    Ok(Err(_)) => Err(crate::server::response::WebDriverErrorResponse::unknown_error("eval channel closed")),
    Err(_) => Err(crate::server::response::WebDriverErrorResponse::script_timeout()),
  }
}

async fn page_load_timeout(state: &Arc<AppState>, session_id: &str) -> Result<u64, crate::server::response::WebDriverErrorResponse> {
  Ok(state.sessions.read().await.get(session_id)?.timeouts.page_load_ms)
}

async fn script_timeout(state: &Arc<AppState>, session_id: &str) -> Result<u64, crate::server::response::WebDriverErrorResponse> {
  Ok(state.sessions.read().await.get(session_id)?.timeouts.script_ms)
}

#[derive(Debug, Deserialize)]
pub struct NavigateRequest {
  pub url: String,
}

/// POST `/session/{session_id}/url`
pub async fn navigate(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
  Json(req): Json<NavigateRequest>,
) -> WebDriverResult {
  let timeout = page_load_timeout(&state, &session_id).await?;
  eval(format!("window.location.href = {:?}; null", req.url), timeout).await?;
  Ok(WebDriverResponse::null())
}

/// GET `/session/{session_id}/url`
pub async fn get_url(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
) -> WebDriverResult {
  let timeout = script_timeout(&state, &session_id).await?;
  let result = eval("return window.location.href".to_string(), timeout).await?;
  Ok(WebDriverResponse::success(result))
}

/// GET `/session/{session_id}/title`
pub async fn get_title(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
) -> WebDriverResult {
  let timeout = script_timeout(&state, &session_id).await?;
  let result = eval("return document.title".to_string(), timeout).await?;
  Ok(WebDriverResponse::success(result))
}

/// POST `/session/{session_id}/back`
pub async fn back(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
) -> WebDriverResult {
  let timeout = script_timeout(&state, &session_id).await?;
  eval("window.history.back(); null".to_string(), timeout).await?;
  Ok(WebDriverResponse::null())
}

/// POST `/session/{session_id}/forward`
pub async fn forward(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
) -> WebDriverResult {
  let timeout = script_timeout(&state, &session_id).await?;
  eval("window.history.forward(); null".to_string(), timeout).await?;
  Ok(WebDriverResponse::null())
}

/// POST `/session/{session_id}/refresh`
pub async fn refresh(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
) -> WebDriverResult {
  let timeout = script_timeout(&state, &session_id).await?;
  eval("window.location.reload(); null".to_string(), timeout).await?;
  Ok(WebDriverResponse::null())
}
