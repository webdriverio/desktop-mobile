//! W3C Actions handler (`POST`/`DELETE /session/{id}/actions`).
//!
//! Unlike the Tauri driver — which dispatches real OS-level input through a
//! native platform executor — the Dioxus embedded driver has no native input
//! path: every command is JavaScript run inside the webview through the bridge
//! IPC channel. So pointer/key/wheel actions are **synthesized as DOM events**
//! (`MouseEvent`/`KeyboardEvent`/`WheelEvent`) dispatched on the element under
//! the resolved coordinates, matching what a real browser produces for input.
//!
//! Pointer `origin` resolution (`viewport` / `pointer` / element-center via
//! `getBoundingClientRect`) is handled up front so `element.click(options)` —
//! which WDIO sends as a `pointerMove` with an element origin and x/y defaulting
//! to 0 — lands on the element's center rather than viewport `(0, 0)`. This is
//! the bug that #423 hit on the Tauri side; it is fixed here from the start.

use std::collections::HashMap;
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
use crate::webdriver::element::ELEMENT_KEY;

#[derive(Debug, Deserialize)]
pub struct ActionsRequest {
  pub actions: Vec<ActionSequence>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum ActionSequence {
  #[serde(rename = "key")]
  Key {
    #[serde(rename = "id")]
    _id: String,
    actions: Vec<KeyAction>,
  },
  #[serde(rename = "pointer")]
  Pointer { id: String, actions: Vec<PointerAction> },
  #[serde(rename = "wheel")]
  Wheel {
    #[serde(rename = "id")]
    _id: String,
    actions: Vec<WheelAction>,
  },
  #[serde(rename = "none")]
  None {
    #[serde(rename = "id")]
    _id: String,
    actions: Vec<PauseAction>,
  },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum KeyAction {
  #[serde(rename = "keyDown")]
  KeyDown { value: String },
  #[serde(rename = "keyUp")]
  KeyUp { value: String },
  #[serde(rename = "pause")]
  Pause { duration: Option<u64> },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum PointerAction {
  #[serde(rename = "pointerDown")]
  PointerDown { button: u32 },
  #[serde(rename = "pointerUp")]
  PointerUp { button: u32 },
  #[serde(rename = "pointerMove")]
  PointerMove {
    x: i32,
    y: i32,
    duration: Option<u64>,
    #[serde(default)]
    origin: Option<Origin>,
  },
  #[serde(rename = "pause")]
  Pause { duration: Option<u64> },
  // A valid W3C pointer action; accept it so it doesn't 400 the whole request, even though
  // WDIO doesn't emit it for the mouse pointer type this driver synthesizes.
  #[serde(rename = "pointerCancel")]
  PointerCancel,
}

/// Coordinate origin for a `pointerMove`. Per the WebDriver Actions spec the
/// `origin` is either the string `"viewport"` (the default — x/y are absolute
/// viewport coordinates), `"pointer"` (x/y are relative to the current pointer
/// position), or an element reference object
/// `{ "element-6066-11e4-a52e-4f735466cecf": "<id>" }` (x/y are offsets from the
/// element's in-view center point). WebdriverIO sends the element form for
/// `element.click(options)` with x/y defaulting to 0, so this must resolve to the
/// element's center rather than viewport `(0, 0)`.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum Origin {
  Named(String),
  Element(HashMap<String, String>),
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum WheelAction {
  #[serde(rename = "scroll")]
  Scroll {
    x: i32,
    y: i32,
    #[serde(rename = "deltaX")]
    delta_x: i32,
    #[serde(rename = "deltaY")]
    delta_y: i32,
    #[serde(default)]
    duration: Option<u64>,
  },
  #[serde(rename = "pause")]
  Pause { duration: Option<u64> },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum PauseAction {
  #[serde(rename = "pause")]
  Pause { duration: Option<u64> },
}

/// Current pointer position while replaying an actions request.
struct PointerState {
  x: i32,
  y: i32,
}

/// Run a script through the bridge eval channel, ignoring its return value.
async fn eval(script: String, timeout_ms: u64) -> Result<(), WebDriverErrorResponse> {
  let (tx, rx) = oneshot::channel();
  let id = Uuid::new_v4().to_string();
  wdio_dioxus_bridge::embedded::push(id, script, vec![], tx);
  match tokio::time::timeout(Duration::from_millis(timeout_ms), rx).await {
    Ok(Ok(Ok(_))) => Ok(()),
    Ok(Ok(Err(e))) => Err(WebDriverErrorResponse::javascript_error(&e, None)),
    Ok(Err(_)) => Err(WebDriverErrorResponse::unknown_error("eval channel closed")),
    Err(_) => Err(WebDriverErrorResponse::script_timeout()),
  }
}

/// Run a script that returns a `[x, y]` pair of numbers.
async fn eval_point(script: String, timeout_ms: u64) -> Result<(i32, i32), WebDriverErrorResponse> {
  let (tx, rx) = oneshot::channel();
  let id = Uuid::new_v4().to_string();
  wdio_dioxus_bridge::embedded::push(id, script, vec![], tx);
  let value: Value = match tokio::time::timeout(Duration::from_millis(timeout_ms), rx).await {
    Ok(Ok(Ok(v))) => v,
    Ok(Ok(Err(e))) => return Err(WebDriverErrorResponse::javascript_error(&e, None)),
    Ok(Err(_)) => return Err(WebDriverErrorResponse::unknown_error("eval channel closed")),
    Err(_) => return Err(WebDriverErrorResponse::script_timeout()),
  };
  // element_center_js returns JS `null` when the element variable is undefined/null — a stale
  // element reference, which must surface as `stale element reference` (404), not `unknown error`.
  if value.is_null() {
    return Err(WebDriverErrorResponse::stale_element_reference());
  }
  let arr = value
    .as_array()
    .ok_or_else(|| WebDriverErrorResponse::unknown_error("expected [x, y] from element-center eval"))?;
  let x = arr.first().and_then(Value::as_f64);
  let y = arr.get(1).and_then(Value::as_f64);
  match (x, y) {
    (Some(x), Some(y)) => Ok((x.round() as i32, y.round() as i32)),
    _ => Err(WebDriverErrorResponse::stale_element_reference()),
  }
}

/// JS that resolves the in-view center of `window.{var}` to `[cx, cy]`. Mirrors
/// the `getBoundingClientRect()` lookup behind the element `rect` endpoint.
fn element_center_js(var: &str) -> String {
  format!(
    "return (function(){{ if (typeof window.{var} === 'undefined' || window.{var} === null) return null; var r=window.{var}.getBoundingClientRect(); return [r.left + r.width/2, r.top + r.height/2]; }})()"
  )
}

/// JS that synthesizes a `MouseEvent` of `event_type` at viewport `(x, y)`. `button` is the W3C
/// pointer-button index that changed; `buttons` is the cumulative held-button bitmask at the moment
/// the event fires (per the DOM spec these differ — e.g. a left-button `mouseup` reports
/// `button: 0` but `buttons: 0`, and `click`/`contextmenu`/un-pressed `mousemove` report `buttons: 0`).
fn pointer_event_js(event_type: &str, x: i32, y: i32, button: u32, buttons: u32) -> String {
  format!(
    "(function(){{ var t=document.elementFromPoint({x},{y})||document.body; if(!t) return; var e=new MouseEvent({event_type:?},{{bubbles:true,cancelable:true,composed:true,view:window,clientX:{x},clientY:{y},button:{button},buttons:{buttons}}}); t.dispatchEvent(e); }})(); null",
  )
}

/// Translate a W3C key value to its DOM `KeyboardEvent.key` name. WDIO sends special keys
/// (`Key.Enter`, arrows, F-keys, modifiers) as Private-Use-Area codepoints (`\u{E0xx}`); forwarding
/// the raw codepoint as `key` leaves `Key.*` broken, so map the ones the spec defines. Printable
/// characters pass through unchanged. Mirrors the table in tauri-plugin-wdio-webdriver's executor.
fn normalize_key(value: &str) -> &str {
  match value {
    "\u{E006}" | "\u{E007}" => "Enter",
    "\u{E003}" => "Backspace",
    "\u{E004}" => "Tab",
    "\u{E00C}" => "Escape",
    "\u{E00D}" => " ",
    "\u{E012}" => "ArrowLeft",
    "\u{E013}" => "ArrowUp",
    "\u{E014}" => "ArrowRight",
    "\u{E015}" => "ArrowDown",
    "\u{E017}" => "Delete",
    "\u{E031}" => "F1",
    "\u{E032}" => "F2",
    "\u{E033}" => "F3",
    "\u{E034}" => "F4",
    "\u{E035}" => "F5",
    "\u{E036}" => "F6",
    "\u{E037}" => "F7",
    "\u{E038}" => "F8",
    "\u{E039}" => "F9",
    "\u{E03A}" => "F10",
    "\u{E03B}" => "F11",
    "\u{E03C}" => "F12",
    "\u{E008}" => "Shift",
    "\u{E009}" => "Control",
    "\u{E00A}" => "Alt",
    "\u{E03D}" => "Meta",
    other => other,
  }
}

/// JS that synthesizes a `KeyboardEvent` of `event_type` for `value` on the
/// active element.
fn key_event_js(event_type: &str, value: &str) -> String {
  let key = normalize_key(value);
  format!(
    "(function(){{ var t=document.activeElement||document.body; if(!t) return; var e=new KeyboardEvent({event_type:?},{{bubbles:true,cancelable:true,composed:true,key:{key:?}}}); t.dispatchEvent(e); }})(); null"
  )
}

/// JS that synthesizes a `WheelEvent` at viewport `(x, y)` with the given deltas.
fn wheel_event_js(x: i32, y: i32, delta_x: i32, delta_y: i32) -> String {
  format!(
    "(function(){{ var t=document.elementFromPoint({x},{y})||document.body; if(!t) return; var e=new WheelEvent('wheel',{{bubbles:true,cancelable:true,composed:true,view:window,clientX:{x},clientY:{y},deltaX:{delta_x},deltaY:{delta_y}}}); t.dispatchEvent(e); }})(); null"
  )
}

/// The `MouseEvent.buttons` bitmask for a held W3C pointer `button` index.
fn button_to_mask(button: u32) -> u32 {
  match button {
    0 => 1, // primary / left
    1 => 4, // auxiliary / middle
    2 => 2, // secondary / right
    n => 1 << n,
  }
}

/// POST `/session/{session_id}/actions` — perform actions.
#[allow(clippy::too_many_lines)]
pub async fn perform(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
  Json(request): Json<ActionsRequest>,
) -> WebDriverResult {
  let (timeout_ms, start_pos, initial_mask) = {
    let sessions = state.sessions.read().await;
    let session = sessions.get(&session_id)?;
    let mask = session.action_state.pressed_buttons.values().flatten().fold(0u32, |m, b| m | button_to_mask(*b));
    (session.timeouts.script_ms, session.action_state.pointer_position, mask)
  };

  let mut pointer_state = PointerState { x: start_pos.0, y: start_pos.1 };
  // The cumulative `MouseEvent.buttons` mask, kept in sync with press/release so each synthesized
  // event reports the buttons actually held when it fires (not just the one that changed).
  let mut held_mask = initial_mask;
  // Position of the last primary-button press, used to synthesize a `click`
  // when the matching release lands on the same spot (a click, not a drag).
  let mut primary_down_pos: Option<(i32, i32)> = None;
  // Position of the previous synthesized `click` within this request, used to emit a `dblclick`
  // when a second click lands on the same spot (e.g. element.doubleClick()'s two press/release pairs).
  let mut last_click_pos: Option<(i32, i32)> = None;

  // Sources are processed serially (each source's actions in full) rather than tick-interleaved
  // across sources, mirroring the Tauri handler. Single-source chains — the common WDIO case — are
  // identical either way; cross-source interleaving (e.g. Ctrl+click in one performActions) is a
  // known gap tracked in webdriverio/desktop-mobile#491.
  for action_seq in &request.actions {
    match action_seq {
      ActionSequence::Key { _id: _, actions } => {
        for action in actions {
          match action {
            KeyAction::KeyDown { value } => {
              eval(key_event_js("keydown", value), timeout_ms).await?;
              let mut sessions = state.sessions.write().await;
              if let Ok(session) = sessions.get_mut(&session_id) {
                session.action_state.pressed_keys.insert(value.clone());
              }
            }
            KeyAction::KeyUp { value } => {
              eval(key_event_js("keyup", value), timeout_ms).await?;
              let mut sessions = state.sessions.write().await;
              if let Ok(session) = sessions.get_mut(&session_id) {
                session.action_state.pressed_keys.remove(value);
              }
            }
            KeyAction::Pause { duration } => sleep_for(*duration).await,
          }
        }
      }
      ActionSequence::Pointer { id, actions } => {
        for action in actions {
          match action {
            PointerAction::PointerDown { button } => {
              held_mask |= button_to_mask(*button);
              eval(
                pointer_event_js("mousedown", pointer_state.x, pointer_state.y, *button, held_mask),
                timeout_ms,
              )
              .await?;
              if *button == 0 {
                primary_down_pos = Some((pointer_state.x, pointer_state.y));
              }
              let mut sessions = state.sessions.write().await;
              if let Ok(session) = sessions.get_mut(&session_id) {
                session.action_state.pressed_buttons.entry(id.clone()).or_default().insert(*button);
              }
            }
            PointerAction::PointerUp { button } => {
              held_mask &= !button_to_mask(*button);
              eval(
                pointer_event_js("mouseup", pointer_state.x, pointer_state.y, *button, held_mask),
                timeout_ms,
              )
              .await?;
              // A primary press + release on the same spot is a click; a
              // secondary (right) release there is a context menu. Emit the
              // event the browser would synthesize for real input so element
              // handlers fire. Only the primary button's release consumes the
              // tracked press — a non-primary release must not drop it.
              if *button == 0 {
                if primary_down_pos == Some((pointer_state.x, pointer_state.y)) {
                  let pos = (pointer_state.x, pointer_state.y);
                  eval(pointer_event_js("click", pos.0, pos.1, *button, 0), timeout_ms).await?;
                  // A second click on the same spot completes a double-click — emit `dblclick`
                  // (what element.doubleClick()'s two press/release pairs should produce).
                  if last_click_pos == Some(pos) {
                    eval(pointer_event_js("dblclick", pos.0, pos.1, *button, 0), timeout_ms).await?;
                    last_click_pos = None;
                  } else {
                    last_click_pos = Some(pos);
                  }
                }
                primary_down_pos = None;
              } else if *button == 2 {
                eval(
                  pointer_event_js("contextmenu", pointer_state.x, pointer_state.y, *button, 0),
                  timeout_ms,
                )
                .await?;
              }
              let mut sessions = state.sessions.write().await;
              if let Ok(session) = sessions.get_mut(&session_id) {
                if let Some(buttons) = session.action_state.pressed_buttons.get_mut(id) {
                  buttons.remove(button);
                }
              }
            }
            PointerAction::PointerMove { x, y, duration, origin } => {
              let (target_x, target_y) =
                resolve_origin(&state, &session_id, origin, *x, *y, &pointer_state, timeout_ms).await?;
              pointer_state.x = target_x;
              pointer_state.y = target_y;
              // A move between clicks breaks a double-click chain. element.doubleClick() never moves
              // between its two press/release pairs, so this can't suppress a legitimate dblclick.
              last_click_pos = None;
              sleep_for(*duration).await;
              eval(
                pointer_event_js("mousemove", pointer_state.x, pointer_state.y, 0, held_mask),
                timeout_ms,
              )
              .await?;
            }
            PointerAction::Pause { duration } => sleep_for(*duration).await,
            PointerAction::PointerCancel => {
              // A pointer cancel releases this source's buttons without a click — there's no
              // MouseEvent equivalent, so just drop its tracked state and clear the held mask.
              let mut sessions = state.sessions.write().await;
              if let Ok(session) = sessions.get_mut(&session_id) {
                if let Some(buttons) = session.action_state.pressed_buttons.remove(id) {
                  for button in buttons {
                    held_mask &= !button_to_mask(button);
                  }
                }
              }
              primary_down_pos = None;
            }
          }
        }
      }
      ActionSequence::Wheel { _id: _, actions } => {
        for action in actions {
          match action {
            WheelAction::Scroll { x, y, delta_x, delta_y, duration } => {
              sleep_for(*duration).await;
              eval(wheel_event_js(*x, *y, *delta_x, *delta_y), timeout_ms).await?;
            }
            WheelAction::Pause { duration } => sleep_for(*duration).await,
          }
        }
      }
      ActionSequence::None { _id: _, actions } => {
        for action in actions {
          match action {
            PauseAction::Pause { duration } => sleep_for(*duration).await,
          }
        }
      }
    }
  }

  // Persist the final pointer position for later `origin: "pointer"` resolution.
  {
    let mut sessions = state.sessions.write().await;
    if let Ok(session) = sessions.get_mut(&session_id) {
      session.action_state.pointer_position = (pointer_state.x, pointer_state.y);
    }
  }

  Ok(WebDriverResponse::null())
}

/// Resolve a `pointerMove` origin + x/y offset to absolute viewport coordinates.
async fn resolve_origin(
  state: &Arc<AppState>,
  session_id: &str,
  origin: &Option<Origin>,
  x: i32,
  y: i32,
  pointer_state: &PointerState,
  timeout_ms: u64,
) -> Result<(i32, i32), WebDriverErrorResponse> {
  match origin {
    // No origin (the default) or "viewport": x/y are absolute viewport coords.
    None => Ok((x, y)),
    Some(Origin::Named(name)) if name == "viewport" => Ok((x, y)),
    Some(Origin::Named(name)) if name == "pointer" => Ok((pointer_state.x + x, pointer_state.y + y)),
    // The spec defines only "viewport" and "pointer" as named origins; reject
    // anything else rather than silently treating it as viewport.
    Some(Origin::Named(name)) => Err(WebDriverErrorResponse::invalid_argument(&format!(
      "pointerMove origin '{name}' is not a recognised named origin (expected 'viewport' or 'pointer')"
    ))),
    Some(Origin::Element(refs)) => {
      let element_id = refs.get(ELEMENT_KEY).ok_or_else(|| {
        WebDriverErrorResponse::invalid_argument("pointerMove origin is missing a web element reference")
      })?;
      let var = {
        let sessions = state.sessions.read().await;
        let session = sessions.get(session_id)?;
        session
          .elements
          .get(element_id)
          .ok_or_else(WebDriverErrorResponse::no_such_element)?
          .to_string()
      };
      let (cx, cy) = eval_point(element_center_js(&var), timeout_ms).await?;
      Ok((cx + x, cy + y))
    }
  }
}

async fn sleep_for(duration: Option<u64>) {
  if let Some(ms) = duration {
    if ms > 0 {
      tokio::time::sleep(Duration::from_millis(ms)).await;
    }
  }
}

/// DELETE `/session/{session_id}/actions` — release actions.
pub async fn release(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
) -> WebDriverResult {
  let (timeout_ms, pressed_keys, pressed_buttons, pointer_pos) = {
    let mut sessions = state.sessions.write().await;
    let session = sessions.get_mut(&session_id)?;
    let pressed_keys: Vec<String> = session.action_state.pressed_keys.drain().collect();
    let pressed_buttons = std::mem::take(&mut session.action_state.pressed_buttons);
    let pointer_pos = session.action_state.pointer_position;
    session.action_state.pointer_position = (0, 0);
    (session.timeouts.script_ms, pressed_keys, pressed_buttons, pointer_pos)
  };

  for key in pressed_keys {
    eval(key_event_js("keyup", &key), timeout_ms).await?;
  }
  let mut held_mask = pressed_buttons.values().flatten().fold(0u32, |m, b| m | button_to_mask(*b));
  for (_source_id, buttons) in pressed_buttons {
    for button in buttons {
      held_mask &= !button_to_mask(button);
      eval(pointer_event_js("mouseup", pointer_pos.0, pointer_pos.1, button, held_mask), timeout_ms).await?;
    }
  }

  Ok(WebDriverResponse::null())
}

#[cfg(test)]
mod tests {
  use super::*;

  fn parse(json: &str) -> ActionsRequest {
    serde_json::from_str(json).expect("valid actions request")
  }

  #[test]
  fn should_default_pointer_move_origin_to_none() {
    let req = parse(
      r#"{"actions":[{"type":"pointer","id":"mouse","actions":[
        {"type":"pointerMove","x":10,"y":20}
      ]}]}"#,
    );
    let ActionSequence::Pointer { actions, .. } = &req.actions[0] else {
      panic!("expected pointer sequence");
    };
    match &actions[0] {
      PointerAction::PointerMove { x, y, origin, .. } => {
        assert_eq!((*x, *y), (10, 20));
        assert!(origin.is_none());
      }
      other => panic!("expected pointerMove, got {other:?}"),
    }
  }

  #[test]
  fn should_parse_pointer_cancel() {
    // pointerCancel is a valid W3C pointer action — it must deserialize rather than
    // 400 the whole request (an unknown internally-tagged variant would be rejected).
    let req = parse(
      r#"{"actions":[{"type":"pointer","id":"mouse","actions":[
        {"type":"pointerDown","button":0},
        {"type":"pointerCancel"}
      ]}]}"#,
    );
    let ActionSequence::Pointer { actions, .. } = &req.actions[0] else {
      panic!("expected pointer sequence");
    };
    assert!(matches!(actions[1], PointerAction::PointerCancel));
  }

  #[test]
  fn should_parse_element_origin_for_click_options() {
    // The shape WDIO sends for `element.click({ button: 'right' })`: a
    // pointerMove with an element origin and x/y defaulting to 0.
    let req = parse(
      r#"{"actions":[{"type":"pointer","id":"mouse","parameters":{"pointerType":"mouse"},"actions":[
        {"type":"pointerMove","duration":0,"x":0,"y":0,"origin":{"element-6066-11e4-a52e-4f735466cecf":"e-123"}},
        {"type":"pointerDown","button":2},
        {"type":"pointerUp","button":2}
      ]}]}"#,
    );
    let ActionSequence::Pointer { actions, .. } = &req.actions[0] else {
      panic!("expected pointer sequence");
    };
    match &actions[0] {
      PointerAction::PointerMove { origin: Some(Origin::Element(refs)), .. } => {
        assert_eq!(refs.get(ELEMENT_KEY).map(String::as_str), Some("e-123"));
      }
      other => panic!("expected element-origin pointerMove, got {other:?}"),
    }
  }

  #[test]
  fn should_parse_named_origins() {
    let req = parse(
      r#"{"actions":[{"type":"pointer","id":"mouse","actions":[
        {"type":"pointerMove","x":5,"y":5,"origin":"viewport"},
        {"type":"pointerMove","x":5,"y":5,"origin":"pointer"}
      ]}]}"#,
    );
    let ActionSequence::Pointer { actions, .. } = &req.actions[0] else {
      panic!("expected pointer sequence");
    };
    let names: Vec<&str> = actions
      .iter()
      .filter_map(|a| match a {
        PointerAction::PointerMove { origin: Some(Origin::Named(n)), .. } => Some(n.as_str()),
        _ => None,
      })
      .collect();
    assert_eq!(names, vec!["viewport", "pointer"]);
  }

  #[test]
  fn should_parse_key_wheel_and_pause_sequences() {
    let req = parse(
      r#"{"actions":[
        {"type":"key","id":"kbd","actions":[{"type":"keyDown","value":"a"},{"type":"keyUp","value":"a"},{"type":"pause","duration":5}]},
        {"type":"wheel","id":"wheel","actions":[{"type":"scroll","x":1,"y":2,"deltaX":0,"deltaY":100}]},
        {"type":"none","id":"null","actions":[{"type":"pause","duration":10}]}
      ]}"#,
    );
    assert!(matches!(req.actions[0], ActionSequence::Key { .. }));
    assert!(matches!(req.actions[1], ActionSequence::Wheel { .. }));
    assert!(matches!(req.actions[2], ActionSequence::None { .. }));
  }

  #[test]
  fn element_origin_center_offsets_from_zero_zero() {
    // A click-options move with x/y=0 must resolve to the element CENTER, not
    // viewport (0,0). The center JS adds half-width/half-height to the rect
    // origin; with x/y offsets of 0 the target is exactly the center. This is
    // the #423 regression guard.
    let js = element_center_js("__wdio_elem_1");
    assert!(js.contains("getBoundingClientRect"));
    assert!(js.contains("r.left + r.width/2"));
    assert!(js.contains("r.top + r.height/2"));
  }

  #[test]
  fn pointer_event_js_targets_element_from_point() {
    let down = pointer_event_js("mousedown", 30, 40, 0, 1);
    assert!(down.contains("elementFromPoint(30,40)"));
    assert!(down.contains("clientX:30"));
    assert!(down.contains("clientY:40"));
    assert!(down.contains("button:0"));
    assert!(down.contains("buttons:1"));
    assert!(down.contains("MouseEvent(\"mousedown\""));

    // `button` is the pointer index that changed; `buttons` is the cumulative held mask — they
    // differ on release (a left `mouseup` reports button 0 but buttons 0) and for context menus.
    let up = pointer_event_js("mouseup", 1, 2, 0, 0);
    assert!(up.contains("button:0"));
    assert!(up.contains("buttons:0"));

    let right = pointer_event_js("contextmenu", 1, 2, 2, 0);
    assert!(right.contains("button:2"));
    assert!(right.contains("buttons:0"));

    let dbl = pointer_event_js("dblclick", 5, 6, 0, 0);
    assert!(dbl.contains("MouseEvent(\"dblclick\""));
    assert!(dbl.contains("buttons:0"));
  }

  #[test]
  fn key_event_js_uses_active_element() {
    let js = key_event_js("keydown", "Enter");
    assert!(js.contains("document.activeElement"));
    assert!(js.contains("KeyboardEvent(\"keydown\""));
    assert!(js.contains("key:\"Enter\""));
  }

  #[test]
  fn key_event_js_translates_special_key_codepoints() {
    // WDIO sends Key.Enter as the PUA codepoint \u{E007}; the DOM key must be "Enter", not the raw char.
    assert!(key_event_js("keydown", "\u{E007}").contains("key:\"Enter\""));
    assert!(key_event_js("keyup", "\u{E004}").contains("key:\"Tab\""));
    assert!(key_event_js("keydown", "\u{E015}").contains("key:\"ArrowDown\""));
    // Printable characters pass through unchanged.
    assert!(key_event_js("keydown", "a").contains("key:\"a\""));
  }

  #[test]
  fn wheel_event_js_carries_deltas() {
    let js = wheel_event_js(5, 6, 0, 120);
    assert!(js.contains("elementFromPoint(5,6)"));
    assert!(js.contains("deltaX:0"));
    assert!(js.contains("deltaY:120"));
    assert!(js.contains("WheelEvent('wheel'"));
  }

  #[test]
  fn button_mask_maps_w3c_indices() {
    assert_eq!(button_to_mask(0), 1);
    assert_eq!(button_to_mask(1), 4);
    assert_eq!(button_to_mask(2), 2);
  }
}
