use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Runtime;

use crate::server::AppState;
use crate::webdriver::Timeouts;

#[derive(Deserialize)]
pub struct DirectEvalRequest {
    pub script: String,
    pub window_label: Option<String>,
    pub timeout_ms: Option<u64>,
}

#[derive(Serialize)]
pub struct DirectEvalResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub undef: Option<bool>,
}

/// POST `/wdio/eval` — execute a pre-wrapped async script directly in a webview window
/// without going through the W3C WebDriver session layer or Tauri IPC.
///
/// The script must use the W3C async-script callback contract:
/// `arguments[arguments.length - 1]` is the done callback.
/// The TypeScript `wrapScriptForDirectEval` helper produces scripts in this format.
pub async fn eval<R: Runtime + 'static>(
    State(state): State<Arc<AppState<R>>>,
    Json(req): Json<DirectEvalRequest>,
) -> (StatusCode, Json<DirectEvalResponse>) {
    let label = req.window_label.as_deref().unwrap_or("main");
    let timeouts = Timeouts {
        script_ms: req.timeout_ms.unwrap_or(30_000),
        ..Default::default()
    };

    let executor = match state.get_executor_for_window(label, timeouts, Vec::new()) {
        Ok(e) => e,
        Err(e) => {
            let available = state.get_window_labels().join(", ");
            tracing::warn!("Direct eval: window '{label}' not found: {}", e.message);
            return (
                StatusCode::NOT_FOUND,
                Json(DirectEvalResponse {
                    value: None,
                    error: Some(format!(
                        "Window '{label}' not found. Available: [{available}]"
                    )),
                    undef: None,
                }),
            );
        }
    };

    match executor.execute_direct_eval(&req.script).await {
        Ok(result) => {
            match result.get("ok").and_then(|v| v.as_bool()) {
                Some(true) => {
                    let undef = result.get("undef").and_then(|v| v.as_bool()).unwrap_or(false);
                    (
                        StatusCode::OK,
                        Json(DirectEvalResponse {
                            value: result.get("value").cloned(),
                            error: None,
                            undef: if undef { Some(true) } else { None },
                        }),
                    )
                }
                Some(false) => {
                    let error = result
                        .get("error")
                        .and_then(|v| v.as_str())
                        .unwrap_or("Script execution failed")
                        .to_string();
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        Json(DirectEvalResponse {
                            value: None,
                            error: Some(error),
                            undef: None,
                        }),
                    )
                }
                None => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(DirectEvalResponse {
                        value: None,
                        error: Some("Script result missing required 'ok' field".to_string()),
                        undef: None,
                    }),
                ),
            }
        }
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(DirectEvalResponse {
                value: None,
                error: Some(err.message),
                undef: None,
            }),
        ),
    }
}
