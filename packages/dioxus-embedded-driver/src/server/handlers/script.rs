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
use crate::webdriver::element::{ELEMENT_KEY, SCRIPT_REF_VAR_PREFIX};
use crate::webdriver::session::Session;

const SCRIPT_RESULT_REFS_JS: &str = include_str!("script-result-refs.js");

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
) -> Result<Value, WebDriverErrorResponse> {
  let (tx, rx) = oneshot::channel();
  let id = Uuid::new_v4().to_string();

  // Push the request; the JS polling loop will pick it up within ~10 ms.
  wdio_dioxus_bridge::embedded::push(id, script.to_string(), args.to_vec(), tx);

  match tokio::time::timeout(Duration::from_millis(timeout_ms), rx).await {
    Ok(Ok(Ok(value))) => Ok(value),
    Ok(Ok(Err(error))) => Err(WebDriverErrorResponse::javascript_error(&error, None)),
    Ok(Err(_)) => {
      // Sender dropped (shouldn't happen in normal operation).
      Err(WebDriverErrorResponse::unknown_error("embedded eval channel closed unexpectedly"))
    }
    Err(_) => Err(WebDriverErrorResponse::script_timeout()),
  }
}

/// JS defining `__wdio_refs`, which turns the DOM nodes in a script result into references with IDs
/// that start with `ref_prefix`, kept in the variables `ElementStore::register_script_refs` records.
fn script_result_refs_js(ref_prefix: &str) -> String {
  format!(
    "{SCRIPT_RESULT_REFS_JS}\nvar __wdio_refs = __wdioScriptResultRefs('{ref_prefix}', '{SCRIPT_REF_VAR_PREFIX}');"
  )
}

/// Runs a script whose result may carry references from `script_result_refs_js`, and registers
/// them so later element commands find their nodes.
async fn run_script_with_refs(
  state: &AppState,
  session_id: &str,
  script: &str,
  args: &[Value],
  timeout_ms: u64,
  ref_prefix: &str,
) -> WebDriverResult {
  let result = run_script(script, args, timeout_ms).await?;
  let mut sessions = state.sessions.write().await;
  sessions.get_mut(session_id)?.elements.register_script_refs(&result, ref_prefix);
  Ok(WebDriverResponse::success(result))
}

/// Resolve a request's WebDriver args into (call-site expressions, pass-through values).
///
/// Each element reference (`{"element-6066-…": id}`) becomes a `window[var]`
/// expression inserted directly into the JS call site, so the receiving
/// script gets an actual DOM node. Non-element args become `__argN` slots
/// and are pushed into `pass_through` for delivery via the embedded queue.
/// Stale element refs resolve to `null`.
fn resolve_call_args(session: &Session, args: &[Value]) -> (Vec<String>, Vec<Value>) {
  let mut call_args: Vec<String> = Vec::new();
  let mut pass_through: Vec<Value> = Vec::new();
  let mut pass_idx: usize = 0;

  for arg in args {
    if let Some(elem_id) = arg.get(ELEMENT_KEY).and_then(|v| v.as_str()) {
      let js_expr = if let Some(var_name) = session.elements.get(elem_id) {
        format!("window[{}]", serde_json::to_string(var_name).unwrap_or_else(|_| "null".into()))
      } else {
        "null".into()
      };
      call_args.push(js_expr);
    } else {
      call_args.push(format!("__arg{pass_idx}"));
      pass_through.push(arg.clone());
      pass_idx += 1;
    }
  }

  (call_args, pass_through)
}

/// POST `/session/{session_id}/execute/sync`
///
/// Wraps the script body in a function and passes `args` as positional
/// parameters, matching the W3C WebDriver script execution semantics.
///
/// WebDriver element references (`{"element-6066-11e4-a52e-4f735466cecf": id}`)
/// are resolved to `window[varName]` inline so the script receives an actual
/// DOM node rather than a plain JSON object. This is required for WDIO's
/// `isDisplayed()` atom and other element-aware scripts.
pub async fn execute_sync(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
  Json(request): Json<ExecuteScriptRequest>,
) -> WebDriverResult {
  let ref_prefix = Uuid::new_v4().to_string();
  let (timeout_ms, call_expr, pass_through) = {
    let sessions = state.sessions.read().await;
    let session = sessions.get(&session_id)?;
    let (call_args, pass_through) = resolve_call_args(session, &request.args);

    let param_names: Vec<String> = (0..pass_through.len()).map(|i| format!("__arg{i}")).collect();
    let param_list = param_names.join(", ");
    let call_list = call_args.join(", ");
    let call = if call_list.is_empty() {
      format!("(function() {{ {} }})()", request.script)
    } else {
      format!("(function({param_list}) {{ {} }})({call_list})", request.script)
    };
    let call_expr =
      format!("{}\nreturn __wdio_refs.withRefs(await {call});", script_result_refs_js(&ref_prefix));

    (session.timeouts.script_ms, call_expr, pass_through)
  };

  run_script_with_refs(&state, &session_id, &call_expr, &pass_through, timeout_ms, &ref_prefix)
    .await
}

/// POST `/session/{session_id}/execute/async`
///
/// Async scripts receive an extra `done` callback as the last argument.
/// The script must call it (optionally with a result value) to resolve.
///
/// Element references are resolved the same way as in `execute_sync` so
/// `browser.executeAsync(fn, element)` and WDIO atoms that take elements
/// receive an actual DOM node rather than a plain JSON object.
pub async fn execute_async(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
  Json(request): Json<ExecuteScriptRequest>,
) -> WebDriverResult {
  let ref_prefix = Uuid::new_v4().to_string();
  let (timeout_ms, wrapped, pass_through) = {
    let sessions = state.sessions.read().await;
    let session = sessions.get(&session_id)?;
    let (call_args, pass_through) = resolve_call_args(session, &request.args);

    // Inner-function params name each non-element pass-through plus `__done`.
    // Call site preserves original arg order — resolved element exprs and
    // `__argN` slots — and appends `__done` so it lands as the last argument,
    // matching the W3C async-script contract.
    let param_names: Vec<String> = (0..pass_through.len()).map(|i| format!("__arg{i}")).collect();
    let param_list = if param_names.is_empty() {
      "__done".to_string()
    } else {
      format!("{}, __done", param_names.join(", "))
    };
    let call_list = if call_args.is_empty() {
      "__done".to_string()
    } else {
      format!("{}, __done", call_args.join(", "))
    };

    let wrapped = format!(
      r#"{refs_js}
      return (function() {{
        return new Promise(function(resolve, reject) {{
          var __done = function(result) {{ resolve(__wdio_refs.withRefs(result)); }};
          try {{ (function({param_list}) {{ {script} }})({call_list}); }}
          catch (e) {{ reject(e); }}
        }});
      }})()"#,
      refs_js = script_result_refs_js(&ref_prefix),
      param_list = param_list,
      call_list = call_list,
      script = request.script,
    );

    (session.timeouts.script_ms, wrapped, pass_through)
  };

  run_script_with_refs(&state, &session_id, &wrapped, &pass_through, timeout_ms, &ref_prefix).await
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn script_result_refs_keep_nodes_where_the_element_store_looks() {
    let js = script_result_refs_js("5f0c");

    assert!(js.starts_with(SCRIPT_RESULT_REFS_JS));
    assert!(js.ends_with("var __wdio_refs = __wdioScriptResultRefs('5f0c', '__wdio_elem_');"));
  }
}
