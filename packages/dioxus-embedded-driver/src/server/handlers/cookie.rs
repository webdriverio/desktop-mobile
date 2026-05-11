use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Path, State};
use axum::Json;
use serde::Deserialize;
use serde_json::Value;
use tokio::sync::oneshot;
use uuid::Uuid;

use crate::server::response::{WebDriverErrorResponse, WebDriverResponse, WebDriverResult};
use crate::server::AppState;

async fn eval(script: String, timeout_ms: u64) -> Result<Value, WebDriverErrorResponse> {
  let (tx, rx) = oneshot::channel();
  let id = Uuid::new_v4().to_string();
  wdio_dioxus_bridge::embedded::push(id, script, vec![], tx);
  match tokio::time::timeout(Duration::from_millis(timeout_ms), rx).await {
    Ok(Ok(Ok(v))) => Ok(v),
    Ok(Ok(Err(e))) => Err(WebDriverErrorResponse::javascript_error(&e, None)),
    _ => Err(WebDriverErrorResponse::script_timeout()),
  }
}

async fn timeout(state: &Arc<AppState>, session_id: &str) -> Result<u64, WebDriverErrorResponse> {
  Ok(state.sessions.read().await.get(session_id)?.timeouts.script_ms)
}

/// GET `/session/{session_id}/cookie`
pub async fn get_all(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
) -> WebDriverResult {
  let t = timeout(&state, &session_id).await?;
  let result = eval(
    "(function(){ var s=document.cookie; if(!s.trim()) return []; return s.split(';').map(function(c){ var p=c.indexOf('='); return {name:c.slice(0,p).trim(),value:c.slice(p+1).trim(),path:'/',domain:'',secure:false,httpOnly:false}; }); })()".to_string(),
    t,
  ).await?;
  Ok(WebDriverResponse::success(result))
}

#[derive(Debug, Deserialize)]
pub struct AddCookieRequest {
  pub cookie: Value,
}

/// POST `/session/{session_id}/cookie`
pub async fn add(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
  Json(req): Json<AddCookieRequest>,
) -> WebDriverResult {
  let t = timeout(&state, &session_id).await?;
  let name = req.cookie["name"].as_str().unwrap_or("").to_string();
  let value = req.cookie["value"].as_str().unwrap_or("").to_string();
  eval(
    format!("document.cookie = {name:?} + '=' + {value:?}; null"),
    t,
  ).await?;
  Ok(WebDriverResponse::null())
}

/// DELETE `/session/{session_id}/cookie`
pub async fn delete_all(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
) -> WebDriverResult {
  let t = timeout(&state, &session_id).await?;
  eval(
    "(function(){ document.cookie.split(';').forEach(c=>{ var k=c.split('=')[0].trim(); document.cookie=k+'=;expires=Thu, 01 Jan 1970 00:00:00 GMT'; }); })()".to_string(),
    t,
  ).await?;
  Ok(WebDriverResponse::null())
}

/// GET `/session/{session_id}/cookie/{name}`
pub async fn get(
  State(state): State<Arc<AppState>>,
  Path((session_id, name)): Path<(String, String)>,
) -> WebDriverResult {
  let t = timeout(&state, &session_id).await?;
  let result = eval(
    format!(
      "(function(){{ var c=document.cookie.split(';').find(c=>c.trim().startsWith({name:?}+'=')); if(!c) return null; var p=c.indexOf('='); return {{name:c.slice(0,p).trim(),value:c.slice(p+1).trim(),path:'/',domain:'',secure:false,httpOnly:false}}; }})()"
    ),
    t,
  ).await?;
  if result.is_null() {
    Err(WebDriverErrorResponse::no_such_cookie(&name))
  } else {
    Ok(WebDriverResponse::success(result))
  }
}

/// DELETE `/session/{session_id}/cookie/{name}`
pub async fn delete(
  State(state): State<Arc<AppState>>,
  Path((session_id, name)): Path<(String, String)>,
) -> WebDriverResult {
  let t = timeout(&state, &session_id).await?;
  eval(
    format!("document.cookie = {name:?} + '=;expires=Thu, 01 Jan 1970 00:00:00 GMT'; null"),
    t,
  ).await?;
  Ok(WebDriverResponse::null())
}
