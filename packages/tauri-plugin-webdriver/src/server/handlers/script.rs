use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use serde::Deserialize;
use serde_json::Value;
use tauri::Runtime;
use uuid::Uuid;

use crate::server::response::{WebDriverErrorResponse, WebDriverResponse, WebDriverResult};
use crate::server::AppState;

#[derive(Debug, Deserialize)]
pub struct ExecuteScriptRequest {
  pub script: String,
  #[serde(default)]
  pub args: Vec<Value>,
}

/// POST `/session/{session_id}/execute/sync` - Execute synchronous script
pub async fn execute_sync<R: Runtime + 'static>(
  State(state): State<Arc<AppState<R>>>,
  Path(session_id): Path<String>,
  Json(request): Json<ExecuteScriptRequest>,
) -> WebDriverResult {
  let sessions = state.sessions.read().await;
  let session = sessions.get(&session_id)?;
  let current_window = session.current_window.clone();
  let timeouts = session.timeouts.clone();
  let frame_context = session.frame_context.clone();
  drop(sessions);

  let ref_prefix = Uuid::new_v4().to_string();
  let executor = state.get_executor_for_window(&current_window, timeouts, frame_context)?;
  let result = executor.execute_script(&request.script, &request.args, &ref_prefix).await?;
  register_script_refs(&state, &session_id, &result, &ref_prefix).await?;
  Ok(WebDriverResponse::success(result))
}

/// POST `/session/{session_id}/execute/async` - Execute asynchronous script
pub async fn execute_async<R: Runtime + 'static>(
  State(state): State<Arc<AppState<R>>>,
  Path(session_id): Path<String>,
  Json(request): Json<ExecuteScriptRequest>,
) -> WebDriverResult {
  let sessions = state.sessions.read().await;
  let session = sessions.get(&session_id)?;
  let current_window = session.current_window.clone();
  let timeouts = session.timeouts.clone();
  let frame_context = session.frame_context.clone();
  drop(sessions);

  let ref_prefix = Uuid::new_v4().to_string();
  let executor = state.get_executor_for_window(&current_window, timeouts, frame_context)?;
  let result = executor.execute_async_script(&request.script, &request.args, &ref_prefix).await?;
  register_script_refs(&state, &session_id, &result, &ref_prefix).await?;
  Ok(WebDriverResponse::success(result))
}

/// Registers the references a script result carries for its DOM nodes, so later element commands
/// find them.
async fn register_script_refs<R: Runtime>(
  state: &AppState<R>,
  session_id: &str,
  result: &Value,
  ref_prefix: &str,
) -> Result<(), WebDriverErrorResponse> {
  let mut sessions = state.sessions.write().await;
  sessions.get_mut(session_id)?.elements.register_script_refs(result, ref_prefix);
  Ok(())
}
