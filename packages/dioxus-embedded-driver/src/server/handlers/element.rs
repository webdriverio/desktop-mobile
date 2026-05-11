//! Element-related WebDriver handlers.
//!
//! All DOM operations are implemented via JavaScript execution through the
//! bridge IPC channel. Elements are stored as global JS variable references
//! (`__wdio_elem_<N>`) and mapped to WebDriver element IDs in the session's
//! `ElementStore`.

use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Path, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::oneshot;
use uuid::Uuid;

use crate::server::response::{WebDriverErrorResponse, WebDriverResponse, WebDriverResult};
use crate::server::AppState;
use crate::webdriver::element::ELEMENT_KEY;

/// Run a script and return its result, or a WebDriver error.
async fn eval(script: String, timeout_ms: u64) -> Result<Value, WebDriverErrorResponse> {
  let (tx, rx) = oneshot::channel();
  let id = Uuid::new_v4().to_string();
  wdio_dioxus_bridge::embedded::push(id, script, vec![], tx);
  match tokio::time::timeout(Duration::from_millis(timeout_ms), rx).await {
    Ok(Ok(Ok(v))) => Ok(v),
    Ok(Ok(Err(e))) => Err(WebDriverErrorResponse::javascript_error(&e, None)),
    Ok(Err(_)) => Err(WebDriverErrorResponse::unknown_error("eval channel closed")),
    Err(_) => Err(WebDriverErrorResponse::script_timeout()),
  }
}

fn js_locator(using: &str, value: &str) -> String {
  match using {
    "css selector" => format!("document.querySelector({value:?})"),
    "xpath" => format!(
      "document.evaluate({value:?}, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue"
    ),
    "link text" => format!(
      "(function(){{ for(var a of document.querySelectorAll('a')) {{ if(a.textContent.trim()==={value:?}) return a; }} return null; }})()"
    ),
    "partial link text" => format!(
      "(function(){{ for(var a of document.querySelectorAll('a')) {{ if(a.textContent.includes({value:?})) return a; }} return null; }})()"
    ),
    "tag name" => format!("document.querySelector({value:?})"),
    _ => format!("document.querySelector({value:?})"),
  }
}

fn js_locator_all(using: &str, value: &str) -> String {
  match using {
    "css selector" => format!("Array.from(document.querySelectorAll({value:?}))"),
    "xpath" => format!(
      "(function(){{ var res = document.evaluate({value:?}, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null); var arr=[]; for(var i=0;i<res.snapshotLength;i++) arr.push(res.snapshotItem(i)); return arr; }})()"
    ),
    "tag name" => format!("Array.from(document.querySelectorAll({value:?}))"),
    _ => format!("Array.from(document.querySelectorAll({value:?}))"),
  }
}

#[derive(Debug, Deserialize)]
pub struct FindElementRequest {
  pub using: String,
  pub value: String,
}

#[derive(Debug, Deserialize)]
pub struct SendKeysRequest {
  pub text: String,
}

async fn session_timeout(state: &Arc<AppState>, session_id: &str) -> Result<u64, WebDriverErrorResponse> {
  let sessions = state.sessions.read().await;
  Ok(sessions.get(session_id)?.timeouts.script_ms)
}

/// POST `/session/{session_id}/element`
pub async fn find(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
  Json(req): Json<FindElementRequest>,
) -> WebDriverResult {
  let timeout = session_timeout(&state, &session_id).await?;
  let var = format!("__wdio_elem_{}", Uuid::new_v4().simple());
  let script = format!(
    "window.{var} = {}; window.{var} !== null && window.{var} !== undefined ? '{}' : null",
    js_locator(&req.using, &req.value),
    var
  );
  let result = eval(script, timeout).await?;
  match result.as_str() {
    Some(v) if !v.is_empty() => {
      let mut sessions = state.sessions.write().await;
      let session = sessions.get_mut(&session_id)?;
      let elem_id = session.elements.insert(v.to_string());
      Ok(WebDriverResponse::success(json!({ ELEMENT_KEY: elem_id })))
    }
    _ => Err(WebDriverErrorResponse::no_such_element()),
  }
}

/// POST `/session/{session_id}/elements`
pub async fn find_all(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
  Json(req): Json<FindElementRequest>,
) -> WebDriverResult {
  let timeout = session_timeout(&state, &session_id).await?;
  let script = format!(
    "(function(){{ var elems = {}; var vars = []; for(var i=0;i<elems.length;i++) {{ var k='__wdio_elem_'+Date.now()+'_'+i; window[k]=elems[i]; vars.push(k); }} return vars; }})()",
    js_locator_all(&req.using, &req.value)
  );
  let result = eval(script, timeout).await?;
  let vars = result.as_array().cloned().unwrap_or_default();
  let mut sessions = state.sessions.write().await;
  let session = sessions.get_mut(&session_id)?;
  let refs: Vec<Value> = vars
    .into_iter()
    .filter_map(|v| v.as_str().map(str::to_string))
    .map(|var| {
      let id = session.elements.insert(var);
      json!({ ELEMENT_KEY: id })
    })
    .collect();
  Ok(WebDriverResponse::success(refs))
}

/// GET `/session/{session_id}/element/active`
pub async fn get_active(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
) -> WebDriverResult {
  let timeout = session_timeout(&state, &session_id).await?;
  let var = format!("__wdio_active_{}", Uuid::new_v4().simple());
  let script = format!("window.{var} = document.activeElement; '{var}'");
  let result = eval(script, timeout).await?;
  match result.as_str() {
    Some(v) => {
      let mut sessions = state.sessions.write().await;
      let session = sessions.get_mut(&session_id)?;
      let id = session.elements.insert(v.to_string());
      Ok(WebDriverResponse::success(json!({ ELEMENT_KEY: id })))
    }
    None => Err(WebDriverErrorResponse::no_such_element()),
  }
}

/// POST `/session/{session_id}/element/{element_id}/element`
pub async fn find_from_element(
  State(state): State<Arc<AppState>>,
  Path((session_id, element_id)): Path<(String, String)>,
  Json(req): Json<FindElementRequest>,
) -> WebDriverResult {
  let timeout = session_timeout(&state, &session_id).await?;
  let var = {
    let sessions = state.sessions.read().await;
    let session = sessions.get(&session_id)?;
    session.elements.get(&element_id).ok_or_else(WebDriverErrorResponse::stale_element_reference)?.to_string()
  };
  let counter = Uuid::new_v4().simple().to_string();
  let child_var = format!("__wdio_child_{counter}");
  let locator = match req.using.as_str() {
    "css selector" => format!("window.{var}.querySelector({:?})", req.value),
    "xpath" => format!(
      "document.evaluate({:?}, window.{var}, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue",
      req.value
    ),
    _ => format!("window.{var}.querySelector({:?})", req.value),
  };
  let script = format!("window.{child_var} = {locator}; window.{child_var} ? '{child_var}' : null");
  let result = eval(script, timeout).await?;
  match result.as_str() {
    Some(v) => {
      let mut sessions = state.sessions.write().await;
      let session = sessions.get_mut(&session_id)?;
      let id = session.elements.insert(v.to_string());
      Ok(WebDriverResponse::success(json!({ ELEMENT_KEY: id })))
    }
    _ => Err(WebDriverErrorResponse::no_such_element()),
  }
}

/// POST `/session/{session_id}/element/{element_id}/elements`
pub async fn find_all_from_element(
  State(state): State<Arc<AppState>>,
  Path((session_id, element_id)): Path<(String, String)>,
  Json(req): Json<FindElementRequest>,
) -> WebDriverResult {
  let timeout = session_timeout(&state, &session_id).await?;
  let var = {
    let sessions = state.sessions.read().await;
    let session = sessions.get(&session_id)?;
    session.elements.get(&element_id).ok_or_else(WebDriverErrorResponse::stale_element_reference)?.to_string()
  };
  let script = format!(
    "(function(){{ var elems=Array.from(window.{var}.querySelectorAll({:?})); var vars=[]; for(var i=0;i<elems.length;i++){{ var k='__wdio_ch_'+Date.now()+'_'+i; window[k]=elems[i]; vars.push(k); }} return vars; }})()",
    req.value
  );
  let result = eval(script, timeout).await?;
  let vars = result.as_array().cloned().unwrap_or_default();
  let mut sessions = state.sessions.write().await;
  let session = sessions.get_mut(&session_id)?;
  let refs: Vec<Value> = vars
    .into_iter()
    .filter_map(|v| v.as_str().map(str::to_string))
    .map(|v| { let id = session.elements.insert(v); json!({ ELEMENT_KEY: id }) })
    .collect();
  Ok(WebDriverResponse::success(refs))
}

/// POST `/session/{session_id}/element/{element_id}/click`
pub async fn click(
  State(state): State<Arc<AppState>>,
  Path((session_id, element_id)): Path<(String, String)>,
) -> WebDriverResult {
  let (timeout, var) = element_var(&state, &session_id, &element_id).await?;
  eval(format!("window.{var}.click(); null"), timeout).await?;
  Ok(WebDriverResponse::null())
}

/// POST `/session/{session_id}/element/{element_id}/clear`
pub async fn clear(
  State(state): State<Arc<AppState>>,
  Path((session_id, element_id)): Path<(String, String)>,
) -> WebDriverResult {
  let (timeout, var) = element_var(&state, &session_id, &element_id).await?;
  eval(format!("window.{var}.value=''; null"), timeout).await?;
  Ok(WebDriverResponse::null())
}

/// POST `/session/{session_id}/element/{element_id}/value`
pub async fn send_keys(
  State(state): State<Arc<AppState>>,
  Path((session_id, element_id)): Path<(String, String)>,
  Json(req): Json<SendKeysRequest>,
) -> WebDriverResult {
  let (timeout, var) = element_var(&state, &session_id, &element_id).await?;
  let text = req.text.replace('`', "\\`").replace("${", "\\${");
  eval(
    format!(
      "(function(){{ var el=window.{var}; el.focus(); el.value+=`{text}`; el.dispatchEvent(new Event('input',{{bubbles:true}})); el.dispatchEvent(new Event('change',{{bubbles:true}})); }})()"
    ),
    timeout,
  ).await?;
  Ok(WebDriverResponse::null())
}

/// GET `/session/{session_id}/element/{element_id}/text`
pub async fn get_text(
  State(state): State<Arc<AppState>>,
  Path((session_id, element_id)): Path<(String, String)>,
) -> WebDriverResult {
  let (timeout, var) = element_var(&state, &session_id, &element_id).await?;
  let result = eval(format!("window.{var}.innerText || window.{var}.textContent || ''"), timeout).await?;
  Ok(WebDriverResponse::success(result))
}

/// GET `/session/{session_id}/element/{element_id}/name`
pub async fn get_tag_name(
  State(state): State<Arc<AppState>>,
  Path((session_id, element_id)): Path<(String, String)>,
) -> WebDriverResult {
  let (timeout, var) = element_var(&state, &session_id, &element_id).await?;
  let result = eval(format!("window.{var}.tagName.toLowerCase()"), timeout).await?;
  Ok(WebDriverResponse::success(result))
}

/// GET `/session/{session_id}/element/{element_id}/attribute/{name}`
pub async fn get_attribute(
  State(state): State<Arc<AppState>>,
  Path((session_id, element_id, name)): Path<(String, String, String)>,
) -> WebDriverResult {
  let (timeout, var) = element_var(&state, &session_id, &element_id).await?;
  let result = eval(format!("window.{var}.getAttribute({name:?})"), timeout).await?;
  Ok(WebDriverResponse::success(result))
}

/// GET `/session/{session_id}/element/{element_id}/property/{name}`
pub async fn get_property(
  State(state): State<Arc<AppState>>,
  Path((session_id, element_id, name)): Path<(String, String, String)>,
) -> WebDriverResult {
  let (timeout, var) = element_var(&state, &session_id, &element_id).await?;
  let result = eval(format!("window.{var}[{name:?}] ?? null"), timeout).await?;
  Ok(WebDriverResponse::success(result))
}

/// GET `/session/{session_id}/element/{element_id}/css/{property_name}`
pub async fn get_css_value(
  State(state): State<Arc<AppState>>,
  Path((session_id, element_id, prop)): Path<(String, String, String)>,
) -> WebDriverResult {
  let (timeout, var) = element_var(&state, &session_id, &element_id).await?;
  let result = eval(
    format!("window.getComputedStyle(window.{var}).getPropertyValue({prop:?})"),
    timeout,
  ).await?;
  Ok(WebDriverResponse::success(result))
}

/// GET `/session/{session_id}/element/{element_id}/rect`
pub async fn get_rect(
  State(state): State<Arc<AppState>>,
  Path((session_id, element_id)): Path<(String, String)>,
) -> WebDriverResult {
  let (timeout, var) = element_var(&state, &session_id, &element_id).await?;
  let result = eval(
    format!(
      "(function(){{ var r=window.{var}.getBoundingClientRect(); return {{x:r.left,y:r.top,width:r.width,height:r.height}}; }})()"
    ),
    timeout,
  ).await?;
  Ok(WebDriverResponse::success(result))
}

/// GET `/session/{session_id}/element/{element_id}/selected`
pub async fn is_selected(
  State(state): State<Arc<AppState>>,
  Path((session_id, element_id)): Path<(String, String)>,
) -> WebDriverResult {
  let (timeout, var) = element_var(&state, &session_id, &element_id).await?;
  let result = eval(format!("!!window.{var}.checked || !!window.{var}.selected"), timeout).await?;
  Ok(WebDriverResponse::success(result))
}

/// GET `/session/{session_id}/element/{element_id}/displayed`
pub async fn is_displayed(
  State(state): State<Arc<AppState>>,
  Path((session_id, element_id)): Path<(String, String)>,
) -> WebDriverResult {
  let (timeout, var) = element_var(&state, &session_id, &element_id).await?;
  let result = eval(
    format!(
      "(function(){{ var el=window.{var}; var s=window.getComputedStyle(el); return s.display!=='none' && s.visibility!=='hidden' && s.opacity!=='0'; }})()"
    ),
    timeout,
  ).await?;
  Ok(WebDriverResponse::success(result))
}

/// GET `/session/{session_id}/element/{element_id}/enabled`
pub async fn is_enabled(
  State(state): State<Arc<AppState>>,
  Path((session_id, element_id)): Path<(String, String)>,
) -> WebDriverResult {
  let (timeout, var) = element_var(&state, &session_id, &element_id).await?;
  let result = eval(format!("!window.{var}.disabled"), timeout).await?;
  Ok(WebDriverResponse::success(result))
}

/// GET `/session/{session_id}/element/{element_id}/screenshot`
pub async fn take_screenshot(
  State(state): State<Arc<AppState>>,
  Path((session_id, _element_id)): Path<(String, String)>,
) -> WebDriverResult {
  let sessions = state.sessions.read().await;
  let _ = sessions.get(&session_id)?;
  // Placeholder — same as the full-page screenshot.
  Ok(WebDriverResponse::success(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  ))
}

// ── helpers ──────────────────────────────────────────────────────────────────

async fn element_var(
  state: &Arc<AppState>,
  session_id: &str,
  element_id: &str,
) -> Result<(u64, String), WebDriverErrorResponse> {
  let sessions = state.sessions.read().await;
  let session = sessions.get(session_id)?;
  let var = session.elements.get(element_id)
    .ok_or_else(WebDriverErrorResponse::stale_element_reference)?
    .to_string();
  Ok((session.timeouts.script_ms, var))
}
