use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::server::response::{WebDriverErrorResponse, WebDriverResponse, WebDriverResult};
use crate::server::AppState;

#[derive(Debug, Deserialize)]
pub struct CreateSessionRequest {
  #[allow(dead_code)]
  pub capabilities: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionResponse {
  pub session_id: String,
  pub capabilities: Value,
}

/// Extract `wdio:dioxusServiceOptions.windowLabel` from W3C capabilities.
fn extract_window_label(caps: &Value) -> Option<String> {
  caps
    .get("alwaysMatch")
    .and_then(|v| v.get("wdio:dioxusServiceOptions"))
    .and_then(|v| v.get("windowLabel"))
    .and_then(|v| v.as_str())
    .map(str::to_string)
    .or_else(|| {
      caps.get("firstMatch")?.as_array()?.iter().find_map(|item| {
        item
          .get("wdio:dioxusServiceOptions")
          .and_then(|v| v.get("windowLabel"))
          .and_then(|v| v.as_str())
          .map(str::to_string)
      })
    })
}

/// POST `/session` — create a new WebDriver session.
pub async fn create(
  State(state): State<Arc<AppState>>,
  Json(request): Json<CreateSessionRequest>,
) -> WebDriverResult {
  let target = extract_window_label(&request.capabilities);

  // Poll for the target window (or first available if no target specified).
  let initial_window = match state.wait_for_window(10_000).await {
    Some(w) => {
      if let Some(label) = target {
        // Verify the requested label is actually available.
        if state.list_windows().contains(&label) { label } else { w }
      } else {
        w
      }
    }
    None => return Err(WebDriverErrorResponse::no_such_window()),
  };

  let mut sessions = state.sessions.write().await;
  let session = sessions.create(initial_window);
  let response = SessionResponse {
    session_id: session.id.clone(),
    capabilities: json!({
      "browserName": "dioxus",
      "platformName": std::env::consts::OS,
      "acceptInsecureCerts": false,
      "pageLoadStrategy": "normal",
      "setWindowRect": true,
      "timeouts": {
        "implicit": session.timeouts.implicit_ms,
        "pageLoad": session.timeouts.page_load_ms,
        "script": session.timeouts.script_ms,
      }
    }),
  };
  Ok(WebDriverResponse::success(response))
}

/// DELETE `/session/{session_id}` — delete a session.
pub async fn delete(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
) -> WebDriverResult {
  let mut sessions = state.sessions.write().await;
  if sessions.delete(&session_id) {
    Ok(WebDriverResponse::null())
  } else {
    Err(WebDriverErrorResponse::invalid_session_id(&session_id))
  }
}
