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

#[derive(Debug, Deserialize)]
pub struct ExecuteScriptRequest {
  pub script: String,
  #[serde(default)]
  pub args: Vec<Value>,
}

/// Dispatch a script to the webview via the bridge's embedded channel and
/// await the result. Returns a WebDriver error on script failure or timeout.
async fn run_script(
  script: &str,
  args: &[Value],
  timeout_ms: u64,
) -> WebDriverResult {
  let (tx, rx) = oneshot::channel();
  let id = Uuid::new_v4().to_string();

  // Push the request; the JS polling loop will pick it up within ~10 ms.
  wdio_dioxus_bridge::embedded::push(id, script.to_string(), args.to_vec(), tx);

  match tokio::time::timeout(Duration::from_millis(timeout_ms), rx).await {
    Ok(Ok(Ok(value))) => Ok(WebDriverResponse::success(value)),
    Ok(Ok(Err(error))) => Err(WebDriverErrorResponse::javascript_error(&error, None)),
    Ok(Err(_)) => {
      // Sender dropped (shouldn't happen in normal operation).
      Err(WebDriverErrorResponse::unknown_error("embedded eval channel closed unexpectedly"))
    }
    Err(_) => Err(WebDriverErrorResponse::script_timeout()),
  }
}

/// POST `/session/{session_id}/execute/sync`
///
/// Wraps the script body in a function and passes `args` as positional
/// parameters, matching the W3C WebDriver script execution semantics.
pub async fn execute_sync(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
  Json(request): Json<ExecuteScriptRequest>,
) -> WebDriverResult {
  let timeout_ms = {
    let sessions = state.sessions.read().await;
    let session = sessions.get(&session_id)?;
    session.timeouts.script_ms
  };

  // Wrap in an IIFE, forwarding args so `arguments[N]` is accessible inside
  // the script body per the W3C WebDriver spec.
  let arg_names: Vec<String> = (0..request.args.len()).map(|i| format!("__arg{i}")).collect();
  let arg_list = arg_names.join(", ");
  let wrapped = if arg_list.is_empty() {
    format!("(function() {{ {} }})()", request.script)
  } else {
    format!("(function({arg_list}) {{ {} }})({arg_list})", request.script)
  };
  run_script(&wrapped, &request.args, timeout_ms).await
}

/// POST `/session/{session_id}/execute/async`
///
/// Async scripts receive an extra `done` callback as the last argument.
/// The script must call it (optionally with a result value) to resolve.
pub async fn execute_async(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
  Json(request): Json<ExecuteScriptRequest>,
) -> WebDriverResult {
  let timeout_ms = {
    let sessions = state.sessions.read().await;
    let session = sessions.get(&session_id)?;
    session.timeouts.script_ms
  };

  // Async script: add a `done` callback as the last argument and wrap in a
  // Promise so the polling loop can await it.
  let arg_names: Vec<String> = (0..request.args.len()).map(|i| format!("__arg{i}")).collect();
  let arg_list = if arg_names.is_empty() {
    "__done".to_string()
  } else {
    format!("{}, __done", arg_names.join(", "))
  };
  let wrapped = format!(
    r#"(function() {{
      return new Promise(function(resolve, reject) {{
        var __done = function(result) {{ resolve(result); }};
        try {{ (function({arg_list}) {{ {script} }})({args}__done); }}
        catch (e) {{ reject(e); }}
      }});
    }})()"#,
    arg_list = arg_list,
    script = request.script,
    args = if arg_names.is_empty() {
      String::new()
    } else {
      format!("{}, ", arg_names.join(", "))
    },
  );
  run_script(&wrapped, &request.args, timeout_ms).await
}
