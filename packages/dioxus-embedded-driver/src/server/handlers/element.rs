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

/// Like `eval`, but prepends a JS staleness guard for `window.{var}`. If the
/// guard fires (the JS context was reset by a page reload), returns
/// `stale_element_reference` instead of `javascript_error`.
async fn eval_for_element(
  var: &str,
  script: String,
  timeout_ms: u64,
) -> Result<Value, WebDriverErrorResponse> {
  let guarded = format!(
    "if (typeof window.{var} === 'undefined' || window.{var} === null) throw '__wdio_stale__'; {script}"
  );
  match eval(guarded, timeout_ms).await {
    Err(e) if e.message == "__wdio_stale__" => {
      Err(WebDriverErrorResponse::stale_element_reference())
    }
    other => other,
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
    "tag name" => format!("document.getElementsByTagName({value:?})[0] ?? null"),
    _ => format!("document.querySelector({value:?})"),
  }
}

fn js_locator_all(using: &str, value: &str) -> String {
  match using {
    "css selector" => format!("Array.from(document.querySelectorAll({value:?}))"),
    "xpath" => format!(
      "(function(){{ var res = document.evaluate({value:?}, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null); var arr=[]; for(var i=0;i<res.snapshotLength;i++) arr.push(res.snapshotItem(i)); return arr; }})()"
    ),
    "link text" => format!(
      "Array.from(document.querySelectorAll('a')).filter(function(a){{ return a.textContent.trim()==={value:?}; }})"
    ),
    "partial link text" => format!(
      "Array.from(document.querySelectorAll('a')).filter(function(a){{ return a.textContent.includes({value:?}); }})"
    ),
    "tag name" => format!("Array.from(document.getElementsByTagName({value:?}))"),
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

async fn session_timeout(
  state: &Arc<AppState>,
  session_id: &str,
) -> Result<u64, WebDriverErrorResponse> {
  let sessions = state.sessions.read().await;
  Ok(sessions.get(session_id)?.timeouts.script_ms)
}

/// POST `/session/{session_id}/element`
pub async fn find(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
  Json(req): Json<FindElementRequest>,
) -> WebDriverResult {
  let (script_timeout, implicit_ms) = {
    let sessions = state.sessions.read().await;
    let t = &sessions.get(&session_id)?.timeouts;
    (t.script_ms, t.implicit_ms)
  };
  let var = format!("__wdio_elem_{}", Uuid::new_v4().simple());
  let script = format!(
    "window.{var} = {}; return window.{var} !== null && window.{var} !== undefined ? '{}' : null",
    js_locator(&req.using, &req.value),
    var
  );
  let deadline = tokio::time::Instant::now() + Duration::from_millis(implicit_ms);
  loop {
    let result = eval(script.clone(), script_timeout).await?;
    match result.as_str() {
      Some(v) if !v.is_empty() => {
        let mut sessions = state.sessions.write().await;
        let session = sessions.get_mut(&session_id)?;
        let elem_id = session.elements.insert(v.to_string());
        return Ok(WebDriverResponse::success(json!({ ELEMENT_KEY: elem_id })));
      }
      _ => {
        if tokio::time::Instant::now() >= deadline {
          return Err(WebDriverErrorResponse::no_such_element());
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
      }
    }
  }
}

/// POST `/session/{session_id}/elements`
pub async fn find_all(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
  Json(req): Json<FindElementRequest>,
) -> WebDriverResult {
  let (script_timeout, implicit_ms) = {
    let sessions = state.sessions.read().await;
    let t = &sessions.get(&session_id)?.timeouts;
    (t.script_ms, t.implicit_ms)
  };
  let prefix = Uuid::new_v4().simple().to_string();
  let locator = js_locator_all(&req.using, &req.value);
  let script = format!(
    "return (function(){{ var elems = {locator}; var vars = []; for(var i=0;i<elems.length;i++) {{ var k='__wdio_elem_{prefix}_'+i; window[k]=elems[i]; vars.push(k); }} return vars; }})()"
  );
  let deadline = tokio::time::Instant::now() + Duration::from_millis(implicit_ms);
  loop {
    let result = eval(script.clone(), script_timeout).await?;
    let vars: Vec<String> = result
      .as_array()
      .cloned()
      .unwrap_or_default()
      .into_iter()
      .filter_map(|v| v.as_str().map(str::to_string))
      .collect();
    if !vars.is_empty() || tokio::time::Instant::now() >= deadline {
      let mut sessions = state.sessions.write().await;
      let session = sessions.get_mut(&session_id)?;
      let refs: Vec<Value> = vars
        .into_iter()
        .map(|var| {
          let id = session.elements.insert(var);
          json!({ ELEMENT_KEY: id })
        })
        .collect();
      return Ok(WebDriverResponse::success(refs));
    }
    tokio::time::sleep(Duration::from_millis(50)).await;
  }
}

/// GET `/session/{session_id}/element/active`
pub async fn get_active(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
) -> WebDriverResult {
  let timeout = session_timeout(&state, &session_id).await?;
  let var = format!("__wdio_active_{}", Uuid::new_v4().simple());
  let script = format!("window.{var} = document.activeElement; return '{var}'");
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
  let (script_timeout, implicit_ms, var) = {
    let sessions = state.sessions.read().await;
    let session = sessions.get(&session_id)?;
    let v = session
      .elements
      .get(&element_id)
      .ok_or_else(WebDriverErrorResponse::stale_element_reference)?
      .to_string();
    (session.timeouts.script_ms, session.timeouts.implicit_ms, v)
  };
  let child_var = format!("__wdio_child_{}", Uuid::new_v4().simple());
  let locator = match req.using.as_str() {
    "css selector" => format!("window.{var}.querySelector({:?})", req.value),
    "xpath" => format!(
      "document.evaluate({:?}, window.{var}, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue",
      req.value
    ),
    "link text" => format!(
      "(function(){{ for(var a of window.{var}.querySelectorAll('a')) {{ if(a.textContent.trim()==={:?}) return a; }} return null; }})()",
      req.value
    ),
    "partial link text" => format!(
      "(function(){{ for(var a of window.{var}.querySelectorAll('a')) {{ if(a.textContent.includes({:?})) return a; }} return null; }})()",
      req.value
    ),
    "tag name" => format!("window.{var}.getElementsByTagName({:?})[0] ?? null", req.value),
    _ => format!("window.{var}.querySelector({:?})", req.value),
  };
  let script =
    format!("window.{child_var} = {locator}; return window.{child_var} ? '{child_var}' : null");
  let deadline = tokio::time::Instant::now() + Duration::from_millis(implicit_ms);
  loop {
    let result = eval_for_element(&var, script.clone(), script_timeout).await?;
    match result.as_str() {
      Some(v) => {
        let mut sessions = state.sessions.write().await;
        let session = sessions.get_mut(&session_id)?;
        let id = session.elements.insert(v.to_string());
        return Ok(WebDriverResponse::success(json!({ ELEMENT_KEY: id })));
      }
      _ => {
        if tokio::time::Instant::now() >= deadline {
          return Err(WebDriverErrorResponse::no_such_element());
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
      }
    }
  }
}

/// POST `/session/{session_id}/element/{element_id}/elements`
pub async fn find_all_from_element(
  State(state): State<Arc<AppState>>,
  Path((session_id, element_id)): Path<(String, String)>,
  Json(req): Json<FindElementRequest>,
) -> WebDriverResult {
  let (script_timeout, implicit_ms, var) = {
    let sessions = state.sessions.read().await;
    let session = sessions.get(&session_id)?;
    let v = session
      .elements
      .get(&element_id)
      .ok_or_else(WebDriverErrorResponse::stale_element_reference)?
      .to_string();
    (session.timeouts.script_ms, session.timeouts.implicit_ms, v)
  };
  let prefix = Uuid::new_v4().simple().to_string();
  let collection = match req.using.as_str() {
    "xpath" => format!(
      "(function(){{ var res=document.evaluate({:?},window.{var},null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null); var arr=[]; for(var i=0;i<res.snapshotLength;i++) arr.push(res.snapshotItem(i)); return arr; }})()",
      req.value
    ),
    "link text" => format!(
      "Array.from(window.{var}.querySelectorAll('a')).filter(function(a){{ return a.textContent.trim()==={:?}; }})",
      req.value
    ),
    "partial link text" => format!(
      "Array.from(window.{var}.querySelectorAll('a')).filter(function(a){{ return a.textContent.includes({:?}); }})",
      req.value
    ),
    "tag name" => format!("Array.from(window.{var}.getElementsByTagName({:?}))", req.value),
    _ => format!("Array.from(window.{var}.querySelectorAll({:?}))", req.value),
  };
  let script = format!(
    "return (function(){{ var elems={collection}; var vars=[]; for(var i=0;i<elems.length;i++){{ var k='__wdio_ch_{prefix}_'+i; window[k]=elems[i]; vars.push(k); }} return vars; }})()"
  );
  let deadline = tokio::time::Instant::now() + Duration::from_millis(implicit_ms);
  loop {
    let result = eval_for_element(&var, script.clone(), script_timeout).await?;
    let vars: Vec<String> = result
      .as_array()
      .cloned()
      .unwrap_or_default()
      .into_iter()
      .filter_map(|v| v.as_str().map(str::to_string))
      .collect();
    if !vars.is_empty() || tokio::time::Instant::now() >= deadline {
      let mut sessions = state.sessions.write().await;
      let session = sessions.get_mut(&session_id)?;
      let refs: Vec<Value> = vars
        .into_iter()
        .map(|v| {
          let id = session.elements.insert(v);
          json!({ ELEMENT_KEY: id })
        })
        .collect();
      return Ok(WebDriverResponse::success(refs));
    }
    tokio::time::sleep(Duration::from_millis(50)).await;
  }
}

/// POST `/session/{session_id}/element/{element_id}/click`
pub async fn click(
  State(state): State<Arc<AppState>>,
  Path((session_id, element_id)): Path<(String, String)>,
) -> WebDriverResult {
  let (timeout, var) = element_var(&state, &session_id, &element_id).await?;
  eval_for_element(&var, format!("return {}", click_press_script(&var)), timeout).await?;
  eval_for_element(&var, format!("return {}", click_release_script(&var)), timeout).await?;
  Ok(WebDriverResponse::null())
}

/// POST `/session/{session_id}/element/{element_id}/clear`
pub async fn clear(
  State(state): State<Arc<AppState>>,
  Path((session_id, element_id)): Path<(String, String)>,
) -> WebDriverResult {
  let (timeout, var) = element_var(&state, &session_id, &element_id).await?;
  let result =
    eval_for_element(&var, format!("return {}", clear_element_script(&var)), timeout).await?;
  if result.as_str() == Some("not editable") {
    return Err(WebDriverErrorResponse::invalid_element_state(
      "element is disabled, read-only, or not a text field or contenteditable, so it cannot be cleared",
    ));
  }
  Ok(WebDriverResponse::null())
}

/// POST `/session/{session_id}/element/{element_id}/value`
pub async fn send_keys(
  State(state): State<Arc<AppState>>,
  Path((session_id, element_id)): Path<(String, String)>,
  Json(req): Json<SendKeysRequest>,
) -> WebDriverResult {
  let (timeout, var) = element_var(&state, &session_id, &element_id).await?;
  let result =
    eval_for_element(&var, format!("return {}", send_keys_script(&var, &req.text)), timeout)
      .await?;
  match result.as_str() {
    Some("immutable") => Err(WebDriverErrorResponse::element_not_interactable(
      "form control is read-only or disabled, so its value cannot be set",
    )),
    Some("invalid") => Err(WebDriverErrorResponse::invalid_argument(
      "text is not a valid value for this form control",
    )),
    Some("unfocused") => Err(WebDriverErrorResponse::element_not_interactable(
      "element did not take keyboard focus, so keys cannot be sent to it",
    )),
    _ => Ok(WebDriverResponse::null()),
  }
}

/// GET `/session/{session_id}/element/{element_id}/text`
pub async fn get_text(
  State(state): State<Arc<AppState>>,
  Path((session_id, element_id)): Path<(String, String)>,
) -> WebDriverResult {
  let (timeout, var) = element_var(&state, &session_id, &element_id).await?;
  let result = eval_for_element(
    &var,
    format!("return window.{var}.innerText || window.{var}.textContent || ''"),
    timeout,
  )
  .await?;
  Ok(WebDriverResponse::success(result))
}

/// GET `/session/{session_id}/element/{element_id}/name`
pub async fn get_tag_name(
  State(state): State<Arc<AppState>>,
  Path((session_id, element_id)): Path<(String, String)>,
) -> WebDriverResult {
  let (timeout, var) = element_var(&state, &session_id, &element_id).await?;
  let result =
    eval_for_element(&var, format!("return window.{var}.tagName.toLowerCase()"), timeout).await?;
  Ok(WebDriverResponse::success(result))
}

/// GET `/session/{session_id}/element/{element_id}/attribute/{name}`
pub async fn get_attribute(
  State(state): State<Arc<AppState>>,
  Path((session_id, element_id, name)): Path<(String, String, String)>,
) -> WebDriverResult {
  let (timeout, var) = element_var(&state, &session_id, &element_id).await?;
  let result =
    eval_for_element(&var, format!("return window.{var}.getAttribute({name:?})"), timeout).await?;
  Ok(WebDriverResponse::success(result))
}

/// GET `/session/{session_id}/element/{element_id}/property/{name}`
pub async fn get_property(
  State(state): State<Arc<AppState>>,
  Path((session_id, element_id, name)): Path<(String, String, String)>,
) -> WebDriverResult {
  let (timeout, var) = element_var(&state, &session_id, &element_id).await?;
  let result =
    eval_for_element(&var, format!("return window.{var}[{name:?}] ?? null"), timeout).await?;
  Ok(WebDriverResponse::success(result))
}

/// GET `/session/{session_id}/element/{element_id}/css/{property_name}`
pub async fn get_css_value(
  State(state): State<Arc<AppState>>,
  Path((session_id, element_id, prop)): Path<(String, String, String)>,
) -> WebDriverResult {
  let (timeout, var) = element_var(&state, &session_id, &element_id).await?;
  let result = eval_for_element(
    &var,
    format!("return window.getComputedStyle(window.{var}).getPropertyValue({prop:?})"),
    timeout,
  )
  .await?;
  Ok(WebDriverResponse::success(result))
}

/// GET `/session/{session_id}/element/{element_id}/rect`
pub async fn get_rect(
  State(state): State<Arc<AppState>>,
  Path((session_id, element_id)): Path<(String, String)>,
) -> WebDriverResult {
  let (timeout, var) = element_var(&state, &session_id, &element_id).await?;
  let result = eval_for_element(
    &var,
    format!(
      "return (function(){{ var r=window.{var}.getBoundingClientRect(); return {{x:r.left,y:r.top,width:r.width,height:r.height}}; }})()"
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
  let result = eval_for_element(
    &var,
    format!("return !!window.{var}.checked || !!window.{var}.selected"),
    timeout,
  )
  .await?;
  Ok(WebDriverResponse::success(result))
}

/// GET `/session/{session_id}/element/{element_id}/displayed`
pub async fn is_displayed(
  State(state): State<Arc<AppState>>,
  Path((session_id, element_id)): Path<(String, String)>,
) -> WebDriverResult {
  let (timeout, var) = element_var(&state, &session_id, &element_id).await?;
  let result = eval_for_element(
    &var,
    format!(
      "return (function(){{ var el=window.{var}; var s=window.getComputedStyle(el); return s.display!=='none' && s.visibility!=='hidden' && s.opacity!=='0'; }})()"
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
  let result = eval_for_element(&var, format!("return !window.{var}.disabled"), timeout).await?;
  Ok(WebDriverResponse::success(result))
}

/// GET `/session/{session_id}/element/{element_id}/screenshot`
pub async fn take_screenshot(
  State(state): State<Arc<AppState>>,
  Path((session_id, _element_id)): Path<(String, String)>,
) -> WebDriverResult {
  state.sessions.read().await.get(&session_id)?;
  Err(WebDriverErrorResponse::unsupported_operation(super::screenshot::UNSUPPORTED))
}

// ── helpers ──────────────────────────────────────────────────────────────────

/// Page-side helpers for focus moves and form events.
pub(crate) const ELEMENT_EVENTS_JS: &str = include_str!("element-events.js");

/// A JS string literal for `text` that is safe to splice into a script.
fn js_string(text: &str) -> String {
  Value::from(text).to_string()
}

fn click_press_script(js_var: &str) -> String {
  format!(
    r"(function() {{
              {ELEMENT_EVENTS_JS}
              var el = window.{js_var};
              if (!el || !el.isConnected) {{
                  throw '__wdio_stale__';
              }}
              el.scrollIntoView({{ behavior: 'instant', block: 'center', inline: 'center' }});
              wdioPress(el);
              return true;
          }})()"
  )
}

/// JS releasing the press, in its own script so that the page reacts to the press first.
fn click_release_script(js_var: &str) -> String {
  format!(
    r"(function() {{
              {ELEMENT_EVENTS_JS}
              wdioRelease(window.{js_var});
              return true;
          }})()"
  )
}

/// JS for Element Clear: returns 'not editable' for an element W3C can't clear.
fn clear_element_script(js_var: &str) -> String {
  format!(
    r"(function() {{
              {ELEMENT_EVENTS_JS}
              var el = window.{js_var};
              if (!el || !el.isConnected) {{
                  throw '__wdio_stale__';
              }}
              return wdioClearElement(el);
          }})()"
  )
}

/// JS for Element Send Keys. A date, colour or similar input gets `text` as its value at once;
/// otherwise the element takes focus, and whatever receives it takes the text. A text field owes
/// a `change` until focus leaves it. Returns 'immutable', 'invalid' or 'unfocused' on error.
fn send_keys_script(js_var: &str, text: &str) -> String {
  let text = js_string(text);
  format!(
    r"(function() {{
              {ELEMENT_EVENTS_JS}
              var el = window.{js_var};
              if (!el || !el.isConnected) {{
                  throw '__wdio_stale__';
              }}
              var text = {text};
              var valueControlStatus = wdioSetValueControl(el, text);
              if (valueControlStatus) {{
                  return valueControlStatus;
              }}
              var wasFocused = wdioDeepActiveElement() === el;
              // Text inside a contenteditable is focused through its editing host.
              var focusTarget = el;
              while (focusTarget.isContentEditable && focusTarget.parentElement
                  && focusTarget.parentElement.isContentEditable) {{
                  focusTarget = focusTarget.parentElement;
              }}
              wdioFocus(focusTarget);
              var receiver = wdioDeepActiveElement();
              // The body, focus-delegating hosts and an editing host holding the element count as focus.
              var focused = el === document.body || el === document.documentElement || receiver === focusTarget
                  || wdioContains(el, receiver);
              if (!focused) {{
                  return 'unfocused';
              }}
              var textField = receiver.tagName === 'TEXTAREA' || (receiver.tagName === 'INPUT' &&
                  WDIO_TEXT_FIELD_TYPES.includes(receiver.type));
              if (receiver.isContentEditable) {{
                  if (!wasFocused) {{
                      var range = document.createRange();
                      range.selectNodeContents(el);
                      range.collapse(false);
                      var selection = window.getSelection();
                      selection.removeAllRanges();
                      selection.addRange(range);
                  }}
                  if (text !== '') {{
                      document.execCommand('insertText', false, text);
                  }}
              }} else if (!textField) {{
                  receiver.value += text;
                  receiver.dispatchEvent(new Event('input', {{ bubbles: true }}));
                  receiver.dispatchEvent(new Event('change', {{ bubbles: true }}));
              }} else if (!receiver.readOnly && text !== '') {{
                  wdioRecordPendingChange(receiver, receiver.value);
                  receiver.value += text;
                  receiver.dispatchEvent(new Event('input', {{ bubbles: true }}));
              }}
              return 'done';
          }})()"
  )
}

async fn element_var(
  state: &Arc<AppState>,
  session_id: &str,
  element_id: &str,
) -> Result<(u64, String), WebDriverErrorResponse> {
  let sessions = state.sessions.read().await;
  let session = sessions.get(session_id)?;
  let var = session
    .elements
    .get(element_id)
    .ok_or_else(WebDriverErrorResponse::stale_element_reference)?
    .to_string();
  Ok((session.timeouts.script_ms, var))
}

#[cfg(test)]
mod tests {
  use super::*;

  /// The script after the shared helpers, so a test can't match their definitions.
  fn body(script: &str) -> &str {
    let helpers = script.find(ELEMENT_EVENTS_JS).unwrap();
    &script[helpers + ELEMENT_EVENTS_JS.len()..]
  }

  #[test]
  fn click_scrolls_and_presses_then_releases_in_a_later_script() {
    let press = click_press_script("__wdio_elem_abc");
    let pressing = body(&press);
    let scroll = pressing.find("el.scrollIntoView({ behavior: 'instant',").unwrap();
    assert!(scroll < pressing.find("wdioPress(el);").unwrap());
    assert!(!pressing.contains("wdioRelease("));
    let release = click_release_script("__wdio_elem_abc");
    assert!(body(&release).contains("wdioRelease(window.__wdio_elem_abc);"));
  }

  #[test]
  fn clear_returns_the_shared_helpers_status() {
    let script = clear_element_script("__wdio_elem_abc");
    let body = body(&script);
    let stale = body.find("throw '__wdio_stale__';").unwrap();
    assert!(stale < body.find("return wdioClearElement(el);").unwrap());
  }

  #[test]
  fn send_keys_sets_value_controls_and_records_a_text_fields_change_before_typing() {
    let script = send_keys_script("__wdio_elem_abc", "it's\n");
    let body = body(&script);
    assert!(body.contains(&format!("var text = {};", js_string("it's\n"))));
    let set = body.find("wdioSetValueControl(el, text);").unwrap();
    let focus = body.find("wdioFocus(focusTarget);").unwrap();
    let unfocused = body.find("return 'unfocused';").unwrap();
    let text_field = body.find("} else if (!receiver.readOnly && text !== '') {").unwrap();
    let record = body.find("wdioRecordPendingChange(receiver, receiver.value);").unwrap();
    let typed = text_field + body[text_field..].find("receiver.value += text;").unwrap();
    assert!(set < focus && focus < unfocused && unfocused < text_field);
    assert!(text_field < record && record < typed);
    assert!(!body[text_field..].contains("new Event('change'"));
  }

  #[test]
  fn send_keys_types_into_the_field_or_editor_that_takes_focus() {
    let script = send_keys_script("__wdio_elem_abc", "x");
    let body = body(&script);
    assert!(body.contains("focusTarget = focusTarget.parentElement;"));
    assert!(body.contains("|| wdioContains(el, receiver);"));
    let editor = body.find("if (receiver.isContentEditable) {").unwrap();
    let insert = body.find("document.execCommand('insertText', false, text);").unwrap();
    assert!(body.find("return 'unfocused';").unwrap() < editor && editor < insert);
  }
}
