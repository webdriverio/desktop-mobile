use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Path, State};
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::oneshot;
use uuid::Uuid;

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

  // Poll for the target window, using the full 10 s budget regardless of
  // when other windows appear. Without this, a `windowLabel: "settings"`
  // request would fail immediately if the main window registered first but
  // the settings window hadn't opened yet.
  let initial_window = match target {
    Some(label) => {
      if state.wait_for_label(&label, 10_000).await {
        label
      } else {
        return Err(WebDriverErrorResponse::no_such_window());
      }
    }
    None => match state.wait_for_window(10_000).await {
      Some(w) => w,
      None => return Err(WebDriverErrorResponse::no_such_window()),
    },
  };

  let mut sessions = state.sessions.write().await;
  let session = sessions.create(initial_window);
  let response = SessionResponse {
    session_id: session.id.clone(),
    capabilities: json!({
      "browserName": "dioxus",
      "platformName": std::env::consts::OS,
      "acceptInsecureCerts": false,
      "pageLoadStrategy": "none",
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
  // Acquire write lock for the whole delete to prevent a concurrent DELETE
  // from interleaving between the var-collection and the session removal.
  let (vars, script_timeout) = {
    let mut sessions = state.sessions.write().await;
    match sessions.get(&session_id) {
      Ok(session) => {
        let vars = session.elements.all_vars();
        let timeout = session.timeouts.script_ms;
        sessions.delete(&session_id);
        (vars, timeout)
      }
      Err(_) => return Err(WebDriverErrorResponse::invalid_session_id(&session_id)),
    }
  };

  if !vars.is_empty() {
    let cleanup = vars
      .iter()
      .map(|v| format!("delete window[{v:?}]"))
      .collect::<Vec<_>>()
      .join("; ");
    let (tx, rx) = oneshot::channel();
    wdio_dioxus_bridge::embedded::push(Uuid::new_v4().to_string(), format!("{cleanup}; null"), vec![], tx);
    let _ = tokio::time::timeout(Duration::from_millis(script_timeout), rx).await;
  }

  Ok(WebDriverResponse::null())
}
