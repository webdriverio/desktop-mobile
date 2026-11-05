use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Runtime;
use uuid::Uuid;

use crate::platform::script_result_refs_js;
use crate::server::AppState;
use crate::webdriver::Timeouts;

#[derive(Deserialize)]
pub struct DirectEvalRequest {
  pub script: String,
  pub window_label: Option<String>,
  pub timeout_ms: Option<u64>,
  /// The session to register element references in. Without one, DOM nodes in the result are
  /// left as they are, as before sessions were sent.
  pub session_id: Option<String>,
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

fn error_response(status: StatusCode, error: String) -> (StatusCode, Json<DirectEvalResponse>) {
  (status, Json(DirectEvalResponse { value: None, error: Some(error), undef: None }))
}

/// Wraps a DirectEval script so a DOM element or shadow root in its result comes back as a
/// reference with an ID that starts with `ref_prefix`, as in Execute Script.
fn with_script_refs(script: &str, ref_prefix: &str) -> String {
  let refs_js = script_result_refs_js(ref_prefix);
  format!(
    "{refs_js}
var __wdio_done = arguments[arguments.length - 1];
(function () {{
{script}
}}).apply(null, [function (r) {{ __wdio_done(__wdio_refs.withRefs(r)); }}]);"
  )
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
  let timeouts = Timeouts { script_ms: req.timeout_ms.unwrap_or(30_000), ..Default::default() };

  let script_refs = match req.session_id.as_deref() {
    Some(session_id) => {
      if let Err(e) = state.sessions.read().await.get(session_id) {
        return error_response(e.status, e.message);
      }
      let ref_prefix = Uuid::new_v4().to_string();
      Some((session_id, with_script_refs(&req.script, &ref_prefix), ref_prefix))
    }
    None => None,
  };

  let executor = match state.get_executor_for_window(label, timeouts, Vec::new()) {
    Ok(e) => e,
    Err(e) => {
      let available = state.get_window_labels().join(", ");
      tracing::warn!("Direct eval: window '{label}' not found: {}", e.message);
      return error_response(
        StatusCode::NOT_FOUND,
        format!("Window '{label}' not found. Available: [{available}]"),
      );
    }
  };

  let script = script_refs.as_ref().map_or(req.script.as_str(), |(_, wrapped, _)| wrapped.as_str());
  match executor.execute_direct_eval(script).await {
    Ok(result) => match result.get("ok").and_then(|v| v.as_bool()) {
      Some(true) => {
        if let (Some((session_id, _, ref_prefix)), Some(value)) =
          (&script_refs, result.get("value"))
        {
          if let Ok(session) = state.sessions.write().await.get_mut(session_id) {
            session.elements.register_script_refs(value, ref_prefix);
          }
        }
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
        error_response(StatusCode::INTERNAL_SERVER_ERROR, error)
      }
      None => error_response(
        StatusCode::INTERNAL_SERVER_ERROR,
        "Script result missing required 'ok' field".to_string(),
      ),
    },
    Err(err) => error_response(StatusCode::INTERNAL_SERVER_ERROR, err.message),
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::webdriver::element::ELEMENT_VAR_PREFIX;

  #[test]
  fn script_refs_wrapper_converts_the_result_the_script_reports() {
    let wrapped =
      with_script_refs("var __cb = arguments[arguments.length - 1]; __cb(1); // end", "5f0c");

    assert!(wrapped.starts_with(&script_result_refs_js("5f0c")));
    assert!(wrapped.contains(&format!("__wdioScriptResultRefs('5f0c', '{ELEMENT_VAR_PREFIX}')")));
    assert!(wrapped.ends_with(
      "(function () {
var __cb = arguments[arguments.length - 1]; __cb(1); // end
}).apply(null, [function (r) { __wdio_done(__wdio_refs.withRefs(r)); }]);"
    ));
  }

  #[test]
  fn reads_the_session_id_and_still_accepts_a_request_without_one() {
    let with_session: DirectEvalRequest =
      serde_json::from_str(r#"{"script":"s","session_id":"abc"}"#).unwrap();
    let without_session: DirectEvalRequest = serde_json::from_str(r#"{"script":"s"}"#).unwrap();

    assert_eq!(with_session.session_id.as_deref(), Some("abc"));
    assert!(without_session.session_id.is_none());
  }
}
