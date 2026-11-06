use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Runtime;
use uuid::Uuid;

use super::script::register_script_refs;
use crate::server::response::WebDriverErrorResponse;
use crate::server::AppState;
use crate::webdriver::{SessionManager, Timeouts};

#[derive(Deserialize)]
pub struct DirectEvalRequest {
  pub script: String,
  pub window_label: Option<String>,
  pub timeout_ms: Option<u64>,
  /// The session to register the result's element references in. Without one, DOM nodes in the
  /// result are left as they are.
  pub session_id: Option<String>,
  /// Passed to the script before the done callback. A reference comes in as its node.
  #[serde(default)]
  pub args: Vec<Value>,
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

// The service only shows the message, so it starts with the W3C error name
fn webdriver_error_response(e: WebDriverErrorResponse) -> (StatusCode, Json<DirectEvalResponse>) {
  error_response(e.status, format!("{}: {}", e.error, e.message))
}

/// Where a request's script runs, and where its element references go.
#[derive(Debug, PartialEq)]
struct Target {
  window_label: String,
  refs: Option<ScriptRefs>,
}

#[derive(Debug, PartialEq)]
struct ScriptRefs {
  session_id: String,
  ref_prefix: String,
}

// The script runs in the window the service names, not the session's, so it reaches the same window
// as the service's mocks.
fn resolve_target(
  sessions: &SessionManager,
  req: &DirectEvalRequest,
) -> Result<Target, WebDriverErrorResponse> {
  let refs = match req.session_id.as_deref() {
    Some(session_id) => {
      sessions.get(session_id)?;
      Some(ScriptRefs {
        session_id: session_id.to_string(),
        ref_prefix: Uuid::new_v4().to_string(),
      })
    }
    None => None,
  };
  let window_label = req.window_label.clone().unwrap_or_else(|| "main".to_string());
  Ok(Target { window_label, refs })
}

/// POST `/wdio/eval` — execute a pre-wrapped async script directly in the top document of a
/// webview window, without going through Tauri IPC.
///
/// The script must use the W3C async-script callback contract:
/// `arguments[arguments.length - 1]` is the done callback.
/// The TypeScript `wrapScriptForDirectEval` helper produces scripts in this format.
///
/// With a `session_id`, a DOM node in the result comes back as a reference in that session, as from
/// Execute Script. Like one from Find Element, it only works while the session is in the window and
/// document it came from.
pub async fn eval<R: Runtime + 'static>(
  State(state): State<Arc<AppState<R>>>,
  Json(req): Json<DirectEvalRequest>,
) -> (StatusCode, Json<DirectEvalResponse>) {
  let target = match resolve_target(&*state.sessions.read().await, &req) {
    Ok(target) => target,
    Err(e) => return webdriver_error_response(e),
  };
  let label = target.window_label.as_str();
  let timeouts = Timeouts { script_ms: req.timeout_ms.unwrap_or(30_000), ..Default::default() };

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

  let ref_prefix = target.refs.as_ref().map(|refs| refs.ref_prefix.as_str());
  match executor.execute_direct_eval(&req.script, &req.args, ref_prefix).await {
    Ok(result) => match result.get("ok").and_then(|v| v.as_bool()) {
      Some(true) => {
        if let (Some(refs), Some(value)) = (&target.refs, result.get("value")) {
          if let Err(e) =
            register_script_refs(&state.sessions, &refs.session_id, value, &refs.ref_prefix).await
          {
            return webdriver_error_response(e);
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
    Err(err) => webdriver_error_response(err),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn request(json: &str) -> DirectEvalRequest {
    serde_json::from_str(json).unwrap()
  }

  fn sessions_with_one_in(window: &str) -> (SessionManager, String) {
    let mut sessions = SessionManager::new();
    let session_id = sessions.create("main".to_string()).id.clone();
    sessions.get_mut(&session_id).unwrap().current_window = window.to_string();
    (sessions, session_id)
  }

  #[test]
  fn reads_the_session_id_and_args_and_still_accepts_a_request_without_them() {
    let full = request(r#"{"script":"s","session_id":"abc","args":[1,{"a":2}]}"#);
    let bare = request(r#"{"script":"s"}"#);

    assert_eq!(full.session_id.as_deref(), Some("abc"));
    assert_eq!(full.args, vec![serde_json::json!(1), serde_json::json!({ "a": 2 })]);
    assert!(bare.session_id.is_none());
    assert!(bare.args.is_empty());
  }

  #[test]
  fn runs_in_main_not_the_sessions_window_and_registers_refs_in_the_session() {
    let (sessions, session_id) = sessions_with_one_in("second");

    let target = resolve_target(
      &sessions,
      &request(&format!(r#"{{"script":"s","session_id":"{session_id}"}}"#)),
    )
    .unwrap();

    assert_eq!(target.window_label, "main");
    let refs = target.refs.expect("a session should get references");
    assert_eq!(refs.session_id, session_id);
    assert!(!refs.ref_prefix.is_empty());
  }

  #[test]
  fn runs_in_the_window_the_request_names() {
    let (sessions, session_id) = sessions_with_one_in("second");

    let target = resolve_target(
      &sessions,
      &request(&format!(r#"{{"script":"s","session_id":"{session_id}","window_label":"third"}}"#)),
    )
    .unwrap();

    assert_eq!(target.window_label, "third");
    assert!(target.refs.is_some());
  }

  #[test]
  fn runs_in_main_or_the_named_window_and_leaves_nodes_without_a_session() {
    let (sessions, _) = sessions_with_one_in("second");

    assert_eq!(
      resolve_target(&sessions, &request(r#"{"script":"s"}"#)).unwrap(),
      Target { window_label: "main".to_string(), refs: None }
    );
    assert_eq!(
      resolve_target(&sessions, &request(r#"{"script":"s","window_label":"third"}"#)).unwrap(),
      Target { window_label: "third".to_string(), refs: None }
    );
  }

  #[test]
  fn leads_an_error_with_its_w3c_name() {
    let (status, Json(body)) =
      webdriver_error_response(WebDriverErrorResponse::stale_element_reference());

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
      body.error.as_deref(),
      Some("stale element reference: Element is no longer attached to the DOM")
    );
  }

  #[test]
  fn rejects_a_session_the_server_does_not_have() {
    let (sessions, _) = sessions_with_one_in("main");

    let error =
      resolve_target(&sessions, &request(r#"{"script":"s","session_id":"gone"}"#)).unwrap_err();

    assert_eq!(error.status, StatusCode::NOT_FOUND);
    assert_eq!(error.error, "invalid session id");
  }
}
