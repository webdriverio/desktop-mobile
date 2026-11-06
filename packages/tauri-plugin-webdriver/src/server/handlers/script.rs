use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use serde::Deserialize;
use serde_json::Value;
use tauri::Runtime;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::server::response::{WebDriverErrorResponse, WebDriverResponse, WebDriverResult};
use crate::server::AppState;
use crate::webdriver::element::script_ref_ids;
use crate::webdriver::SessionManager;

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
  register_script_refs(&state.sessions, &session_id, &result, &ref_prefix).await?;
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
  register_script_refs(&state.sessions, &session_id, &result, &ref_prefix).await?;
  Ok(WebDriverResponse::success(result))
}

/// Registers a script result's references in the session. Fails if the session has ended, even when
/// there's nothing to register.
pub(crate) async fn register_script_refs(
  sessions: &RwLock<SessionManager>,
  session_id: &str,
  result: &Value,
  ref_prefix: &str,
) -> Result<(), WebDriverErrorResponse> {
  let ids = script_ref_ids(result, ref_prefix);
  if ids.is_empty() {
    sessions.read().await.get(session_id)?;
    return Ok(());
  }
  sessions.write().await.get_mut(session_id)?.elements.register_script_refs(&ids);
  Ok(())
}

#[cfg(test)]
mod tests {
  use serde_json::json;

  use super::*;
  use crate::webdriver::element::ELEMENT_KEY;

  #[tokio::test]
  async fn registers_the_result_refs_in_the_session() {
    let sessions = RwLock::new(SessionManager::new());
    let session_id = sessions.write().await.create("main".to_string()).id.clone();

    register_script_refs(&sessions, &session_id, &json!({ "el": { ELEMENT_KEY: "p-0" } }), "p")
      .await
      .unwrap();

    assert!(sessions.read().await.get(&session_id).unwrap().elements.get("p-0").is_some());
  }

  #[tokio::test]
  async fn fails_when_the_session_has_ended_whether_or_not_the_result_has_refs() {
    let sessions = RwLock::new(SessionManager::new());

    for result in [json!({ ELEMENT_KEY: "p-0" }), json!(1)] {
      let error = register_script_refs(&sessions, "gone", &result, "p").await.unwrap_err();
      assert_eq!(error.error, "invalid session id", "for {result}");
    }
  }
}
