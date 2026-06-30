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

impl ActionSequence {
  /// Number of actions in this source. The request's tick count is the max across all sources.
  fn action_count(&self) -> usize {
    match self {
      ActionSequence::Key { actions, .. } => actions.len(),
      ActionSequence::Pointer { actions, .. } => actions.len(),
      ActionSequence::Wheel { actions, .. } => actions.len(),
      ActionSequence::None { actions, .. } => actions.len(),
    }
  }

  /// The duration (ms) this source's action at `tick` contributes to the tick. Pause, pointer-move
  /// and wheel-scroll actions carry a duration; everything else is instantaneous (`None`). The tick's
  /// duration is the max of these across sources (W3C §17.4.3), not their sum.
  fn duration_at(&self, tick: usize) -> Option<u64> {
    match self {
      ActionSequence::Key { actions, .. } => match actions.get(tick) {
        Some(KeyAction::Pause { duration }) => *duration,
        _ => None,
      },
      ActionSequence::Pointer { actions, .. } => match actions.get(tick) {
        Some(PointerAction::PointerMove { duration, .. }) | Some(PointerAction::Pause { duration }) => *duration,
        _ => None,
      },
      ActionSequence::Wheel { actions, .. } => match actions.get(tick) {
        Some(WheelAction::Scroll { duration, .. }) | Some(WheelAction::Pause { duration }) => *duration,
        _ => None,
      },
      ActionSequence::None { actions, .. } => match actions.get(tick) {
        Some(PauseAction::Pause { duration }) => *duration,
        _ => None,
      },
    }
  }
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
fn pointer_event_js(event_type: &str, x: i32, y: i32, button: u32, buttons: u32, mods: Modifiers) -> String {
  let modifiers = mods.js();
  format!(
    "(function(){{ var t=document.elementFromPoint({x},{y})||document.body; if(!t) return; var e=new MouseEvent({event_type:?},{{bubbles:true,cancelable:true,composed:true,view:window,clientX:{x},clientY:{y},button:{button},buttons:{buttons},{modifiers}}}); t.dispatchEvent(e); }})(); null",
  )
}

/// Active keyboard modifiers, derived from the keys currently held in session state. W3C sends
/// modifier keys as Private-Use-Area codepoints (left + right variants); a held modifier must
/// surface as the matching flag on every synthesized pointer and key event (e.g. a Ctrl+click's
/// `click` carries `ctrlKey: true`). Interleaving a modifier across sources *within one*
/// performActions still needs tick processing — tracked in webdriverio/desktop-mobile#491.
#[derive(Clone, Copy, Default)]
struct Modifiers {
  ctrl: bool,
  shift: bool,
  alt: bool,
  meta: bool,
}

impl Modifiers {
  fn from_keys<'a>(keys: impl IntoIterator<Item = &'a String>) -> Self {
    let mut m = Modifiers::default();
    for k in keys {
      match k.as_str() {
        "\u{E008}" | "\u{E050}" => m.shift = true,
        "\u{E009}" | "\u{E051}" => m.ctrl = true,
        "\u{E00A}" | "\u{E052}" => m.alt = true,
        "\u{E03D}" | "\u{E053}" => m.meta = true,
        _ => {}
      }
    }
    m
  }

  fn js(self) -> String {
    format!("ctrlKey:{},shiftKey:{},altKey:{},metaKey:{}", self.ctrl, self.shift, self.alt, self.meta)
  }
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
    "\u{E008}" | "\u{E050}" => "Shift",
    "\u{E009}" | "\u{E051}" => "Control",
    "\u{E00A}" | "\u{E052}" => "Alt",
    "\u{E03D}" | "\u{E053}" => "Meta",
    other => other,
  }
}

/// Best-effort DOM `KeyboardEvent.code` (the physical key) for a W3C key value — derivable for the
/// special keys, ASCII letters (`KeyA`) and digits (`Digit1`) that keyboard shortcuts use. Returns
/// `""` (the spec default for an undetermined code) for layout-dependent symbols. Left/right modifier
/// codepoints map to their distinct `*Left`/`*Right` codes even though their `key` is shared.
fn key_code(value: &str) -> String {
  let special = match value {
    "\u{E006}" | "\u{E007}" => "Enter",
    "\u{E003}" => "Backspace",
    "\u{E004}" => "Tab",
    "\u{E00C}" => "Escape",
    "\u{E00D}" => "Space",
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
    "\u{E008}" => "ShiftLeft",
    "\u{E050}" => "ShiftRight",
    "\u{E009}" => "ControlLeft",
    "\u{E051}" => "ControlRight",
    "\u{E00A}" => "AltLeft",
    "\u{E052}" => "AltRight",
    "\u{E03D}" => "MetaLeft",
    "\u{E053}" => "MetaRight",
    _ => "",
  };
  if !special.is_empty() {
    return special.to_string();
  }
  let mut chars = value.chars();
  match (chars.next(), chars.next()) {
    (Some(c), None) if c.is_ascii_alphabetic() => format!("Key{}", c.to_ascii_uppercase()),
    (Some(c), None) if c.is_ascii_digit() => format!("Digit{c}"),
    _ => String::new(),
  }
}

/// JS that synthesizes a `KeyboardEvent` of `event_type` for `value` on the
/// active element.
fn key_event_js(event_type: &str, value: &str, mods: Modifiers) -> String {
  let key = normalize_key(value);
  let code = key_code(value);
  let modifiers = mods.js();
  format!(
    "(function(){{ var t=document.activeElement||document.body; if(!t) return; var e=new KeyboardEvent({event_type:?},{{bubbles:true,cancelable:true,composed:true,key:{key:?},code:{code:?},{modifiers}}}); t.dispatchEvent(e); }})(); null"
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
    // `1 << n` overflows (panics in debug, wraps in release) for n >= 32; the buttons bitmask is
    // 32 bits and W3C only defines 0–4, so an out-of-range index contributes no bit.
    n if n < 32 => 1 << n,
    _ => 0,
  }
}

/// The high-level activation events a same-position press+release of pointer `button` synthesizes
/// (a click-like gesture, not a drag). Per the UI Events spec the primary button fires `click`, any
/// non-primary button fires `auxclick`, and the secondary (right) button additionally fires
/// `contextmenu`. `dblclick` is layered on by the caller — it needs cross-gesture state.
fn activation_events(button: u32) -> &'static [&'static str] {
  match button {
    0 => &["click"],
    2 => &["auxclick", "contextmenu"],
    _ => &["auxclick"],
  }
}

/// POST `/session/{session_id}/actions` — perform actions.
#[allow(clippy::too_many_lines)]
pub async fn perform(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
  Json(request): Json<ActionsRequest>,
) -> WebDriverResult {
  let (timeout_ms, start_pos, initial_mask, initial_mods) = {
    let sessions = state.sessions.read().await;
    let session = sessions.get(&session_id)?;
    let mask = session.action_state.pressed_buttons.values().flatten().fold(0u32, |m, b| m | button_to_mask(*b));
    let mods = Modifiers::from_keys(&session.action_state.pressed_keys);
    (session.timeouts.script_ms, session.action_state.pointer_position, mask, mods)
  };

  let mut pointer_state = PointerState { x: start_pos.0, y: start_pos.1 };
  // The cumulative `MouseEvent.buttons` mask, kept in sync with press/release so each synthesized
  // event reports the buttons actually held when it fires (not just the one that changed).
  let mut held_mask = initial_mask;
  // Modifier flags carried on every synthesized event, kept in sync as key actions press/release
  // modifier keys (and seeded from any modifier still held from a prior performActions call).
  let mut modifiers = initial_mods;
  // Position of each button's last press, used to synthesize a `click` (primary) or `auxclick`
  // (non-primary) when the matching release lands on the same spot — an activation, not a drag.
  let mut down_pos: HashMap<u32, (i32, i32)> = HashMap::new();
  // Position of the previous synthesized `click` within this request, used to emit a `dblclick`
  // when a second click lands on the same spot (e.g. element.doubleClick()'s two press/release pairs).
  let mut last_click_pos: Option<(i32, i32)> = None;

  // Process actions tick-by-tick across sources (W3C): the action at index N from every source runs
  // before index N+1 from any source, so cross-source chains interleave correctly (e.g. Ctrl+click
  // built as a key source + a pointer source in one performActions — the modifier is down when the
  // click lands). A source with fewer actions contributes nothing on later ticks.
  let tick_count = request.actions.iter().map(ActionSequence::action_count).max().unwrap_or(0);
  for tick in 0..tick_count {
    // W3C §17.4.3: a tick lasts the *maximum* pause/move/scroll duration across its sources (not the
    // sum), slept once after the tick's actions are dispatched.
    let tick_duration_ms = request.actions.iter().filter_map(|seq| seq.duration_at(tick)).max().unwrap_or(0);
    for action_seq in &request.actions {
      match action_seq {
        ActionSequence::Key { _id: _, actions } => {
          if let Some(action) = actions.get(tick) {
            match action {
              KeyAction::KeyDown { value } => {
                {
                  let mut sessions = state.sessions.write().await;
                  if let Ok(session) = sessions.get_mut(&session_id) {
                    session.action_state.pressed_keys.insert(value.clone());
                    modifiers = Modifiers::from_keys(&session.action_state.pressed_keys);
                  }
                }
                // Recompute before dispatch so a modifier key's own keydown carries its flag.
                eval(key_event_js("keydown", value, modifiers), timeout_ms).await?;
              }
              KeyAction::KeyUp { value } => {
                {
                  let mut sessions = state.sessions.write().await;
                  if let Ok(session) = sessions.get_mut(&session_id) {
                    session.action_state.pressed_keys.remove(value);
                    modifiers = Modifiers::from_keys(&session.action_state.pressed_keys);
                  }
                }
                eval(key_event_js("keyup", value, modifiers), timeout_ms).await?;
              }
              KeyAction::Pause { .. } => {}
            }
          }
        }
        ActionSequence::Pointer { id, actions } => {
          if let Some(action) = actions.get(tick) {
            match action {
              PointerAction::PointerDown { button } => {
                held_mask |= button_to_mask(*button);
                eval(
                  pointer_event_js("mousedown", pointer_state.x, pointer_state.y, *button, held_mask, modifiers),
                  timeout_ms,
                )
                .await?;
                down_pos.insert(*button, (pointer_state.x, pointer_state.y));
                let mut sessions = state.sessions.write().await;
                if let Ok(session) = sessions.get_mut(&session_id) {
                  session.action_state.pressed_buttons.entry(id.clone()).or_default().insert(*button);
                }
              }
              PointerAction::PointerUp { button } => {
                held_mask &= !button_to_mask(*button);
                eval(
                  pointer_event_js("mouseup", pointer_state.x, pointer_state.y, *button, held_mask, modifiers),
                  timeout_ms,
                )
                .await?;
                // A press + release of a button on the same spot is an activation; a drag (released
                // elsewhere) is not. The primary button fires `click`, a non-primary button fires
                // `auxclick`, and the secondary (right) button additionally fires `contextmenu` — the
                // events a browser synthesizes for real input, so element handlers fire.
                let pos = (pointer_state.x, pointer_state.y);
                if down_pos.remove(button) == Some(pos) {
                  for event_type in activation_events(*button) {
                    eval(pointer_event_js(event_type, pos.0, pos.1, *button, 0, modifiers), timeout_ms).await?;
                  }
                  // A second primary click on the same spot completes a double-click — emit `dblclick`
                  // (what element.doubleClick()'s two press/release pairs should produce).
                  if *button == 0 {
                    if last_click_pos == Some(pos) {
                      eval(pointer_event_js("dblclick", pos.0, pos.1, *button, 0, modifiers), timeout_ms).await?;
                      last_click_pos = None;
                    } else {
                      last_click_pos = Some(pos);
                    }
                  }
                }
                let mut sessions = state.sessions.write().await;
                if let Ok(session) = sessions.get_mut(&session_id) {
                  if let Some(buttons) = session.action_state.pressed_buttons.get_mut(id) {
                    buttons.remove(button);
                  }
                }
              }
              PointerAction::PointerMove { x, y, origin, .. } => {
                let (target_x, target_y) =
                  resolve_origin(&state, &session_id, origin, *x, *y, &pointer_state, timeout_ms).await?;
                pointer_state.x = target_x;
                pointer_state.y = target_y;
                // A move between clicks breaks a double-click chain. element.doubleClick() never moves
                // between its two press/release pairs, so this can't suppress a legitimate dblclick.
                last_click_pos = None;
                eval(
                  pointer_event_js("mousemove", pointer_state.x, pointer_state.y, 0, held_mask, modifiers),
                  timeout_ms,
                )
                .await?;
              }
              PointerAction::Pause { .. } => {}
              PointerAction::PointerCancel => {
                // A pointer cancel aborts the gesture: release this source's buttons without a click
                // (there's no MouseEvent equivalent), so drop its tracked state and clear the held mask.
                let mut sessions = state.sessions.write().await;
                if let Ok(session) = sessions.get_mut(&session_id) {
                  if let Some(buttons) = session.action_state.pressed_buttons.remove(id) {
                    for button in buttons {
                      held_mask &= !button_to_mask(button);
                      down_pos.remove(&button);
                    }
                  }
                }
                // The aborted press emits no click/auxclick, and a cancel breaks any pending
                // double-click chain so a later same-spot click isn't misread as a dblclick.
                last_click_pos = None;
              }
            }
          }
        }
        ActionSequence::Wheel { _id: _, actions } => {
          if let Some(action) = actions.get(tick) {
            match action {
              WheelAction::Scroll { x, y, delta_x, delta_y, .. } => {
                eval(wheel_event_js(*x, *y, *delta_x, *delta_y), timeout_ms).await?;
              }
              WheelAction::Pause { .. } => {}
            }
          }
        }
        ActionSequence::None { _id: _, actions } => {
          if let Some(action) = actions.get(tick) {
            match action {
              PauseAction::Pause { .. } => {}
            }
          }
        }
      }
    }
    // The tick's actions are dispatched; wait its longest source duration once.
    if tick_duration_ms > 0 {
      tokio::time::sleep(Duration::from_millis(tick_duration_ms)).await;
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

/// DELETE `/session/{session_id}/actions` — release actions.
pub async fn release(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
) -> WebDriverResult {
  let (timeout_ms, pressed_keys, pressed_buttons, pointer_pos) = {
    let mut sessions = state.sessions.write().await;
    let session = sessions.get_mut(&session_id)?;
    let mut pressed_keys: Vec<String> = session.action_state.pressed_keys.drain().collect();
    // `pressed_keys` drains from a HashSet (unordered); sort so keyup dispatch order is stable.
    pressed_keys.sort();
    let pressed_buttons = std::mem::take(&mut session.action_state.pressed_buttons);
    let pointer_pos = session.action_state.pointer_position;
    session.action_state.pointer_position = (0, 0);
    (session.timeouts.script_ms, pressed_keys, pressed_buttons, pointer_pos)
  };

  // Release held keys; each keyup reflects the modifiers still held *after* it is released
  // (e.g. releasing Shift while Ctrl is still down → shiftKey:false, ctrlKey:true). The mouseups
  // below run once every key is up, so their default (empty) modifiers are correct.
  for (i, key) in pressed_keys.iter().enumerate() {
    let mods = Modifiers::from_keys(&pressed_keys[i + 1..]);
    eval(key_event_js("keyup", key, mods), timeout_ms).await?;
  }
  let mut held_mask = pressed_buttons.values().flatten().fold(0u32, |m, b| m | button_to_mask(*b));
  // Release every held button. `pressed_buttons` drains from a HashMap of HashSets (both unordered);
  // collect and sort so a multi-button release dispatches its mouseups deterministically, each
  // reporting the buttons still held *after* it (the released button is cleared from `held_mask` first).
  let mut buttons_to_release: Vec<u32> = pressed_buttons.into_values().flatten().collect();
  buttons_to_release.sort_unstable();
  for button in buttons_to_release {
    held_mask &= !button_to_mask(button);
    eval(pointer_event_js("mouseup", pointer_pos.0, pointer_pos.1, button, held_mask, Modifiers::default()), timeout_ms).await?;
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
    let down = pointer_event_js("mousedown", 30, 40, 0, 1, Modifiers::default());
    assert!(down.contains("elementFromPoint(30,40)"));
    assert!(down.contains("clientX:30"));
    assert!(down.contains("clientY:40"));
    assert!(down.contains("button:0"));
    assert!(down.contains("buttons:1"));
    assert!(down.contains("MouseEvent(\"mousedown\""));

    // `button` is the pointer index that changed; `buttons` is the cumulative held mask — they
    // differ on release (a left `mouseup` reports button 0 but buttons 0) and for context menus.
    let up = pointer_event_js("mouseup", 1, 2, 0, 0, Modifiers::default());
    assert!(up.contains("button:0"));
    assert!(up.contains("buttons:0"));

    let right = pointer_event_js("contextmenu", 1, 2, 2, 0, Modifiers::default());
    assert!(right.contains("button:2"));
    assert!(right.contains("buttons:0"));

    let aux = pointer_event_js("auxclick", 1, 2, 1, 0, Modifiers::default());
    assert!(aux.contains("MouseEvent(\"auxclick\""));
    assert!(aux.contains("button:1"));
    assert!(aux.contains("buttons:0"));

    let dbl = pointer_event_js("dblclick", 5, 6, 0, 0, Modifiers::default());
    assert!(dbl.contains("MouseEvent(\"dblclick\""));
    assert!(dbl.contains("buttons:0"));
  }

  #[test]
  fn key_event_js_uses_active_element() {
    let js = key_event_js("keydown", "Enter", Modifiers::default());
    assert!(js.contains("document.activeElement"));
    assert!(js.contains("KeyboardEvent(\"keydown\""));
    assert!(js.contains("key:\"Enter\""));
  }

  #[test]
  fn key_event_js_translates_special_key_codepoints() {
    // WDIO sends Key.Enter as the PUA codepoint \u{E007}; the DOM key must be "Enter", not the raw char.
    let m = Modifiers::default();
    assert!(key_event_js("keydown", "\u{E007}", m).contains("key:\"Enter\""));
    assert!(key_event_js("keyup", "\u{E004}", m).contains("key:\"Tab\""));
    assert!(key_event_js("keydown", "\u{E015}", m).contains("key:\"ArrowDown\""));
    // Right-hand modifier variants normalize to the same DOM key name as the left/generic ones.
    assert!(key_event_js("keydown", "\u{E050}", m).contains("key:\"Shift\""));
    assert!(key_event_js("keydown", "\u{E051}", m).contains("key:\"Control\""));
    assert!(key_event_js("keydown", "\u{E053}", m).contains("key:\"Meta\""));
    // Printable characters pass through unchanged.
    assert!(key_event_js("keydown", "a", m).contains("key:\"a\""));
  }

  #[test]
  fn key_event_js_carries_physical_code() {
    let m = Modifiers::default();
    // Special keys and printable chars both get a `code` so apps reading event.code (shortcuts) work.
    assert!(key_event_js("keydown", "\u{E007}", m).contains("code:\"Enter\""));
    assert!(key_event_js("keydown", "a", m).contains("code:\"KeyA\""));
    assert!(key_event_js("keydown", "7", m).contains("code:\"Digit7\""));
    // Left/right modifier variants share a `key` but get distinct `code`s.
    assert!(key_event_js("keydown", "\u{E008}", m).contains("code:\"ShiftLeft\""));
    assert!(key_event_js("keydown", "\u{E050}", m).contains("code:\"ShiftRight\""));
  }

  #[test]
  fn key_code_derives_physical_codes() {
    assert_eq!(key_code("a"), "KeyA");
    assert_eq!(key_code("Z"), "KeyZ");
    assert_eq!(key_code("3"), "Digit3");
    assert_eq!(key_code("\u{E00D}"), "Space");
    assert_eq!(key_code("\u{E053}"), "MetaRight");
    assert_eq!(key_code("\u{E03D}"), "MetaLeft");
    // Layout-dependent symbols and multi-char values can't be resolved → empty (the spec default).
    assert_eq!(key_code("!"), "");
    assert_eq!(key_code("ab"), "");
  }

  #[test]
  fn events_carry_held_modifier_flags() {
    // \u{E009} = Control, \u{E008} = Shift.
    let held = Modifiers::from_keys(&["\u{E009}".to_string(), "\u{E008}".to_string()]);
    let click = pointer_event_js("click", 1, 2, 0, 0, held);
    assert!(click.contains("ctrlKey:true"));
    assert!(click.contains("shiftKey:true"));
    assert!(click.contains("altKey:false"));
    assert!(key_event_js("keydown", "a", held).contains("ctrlKey:true"));
    // No modifier held → all flags false.
    assert!(pointer_event_js("click", 1, 2, 0, 0, Modifiers::default()).contains("ctrlKey:false"));

    // The release path computes each keyup's modifiers from the keys still held after it — so a
    // Shift keyup while Control remains down reports shiftKey:false, ctrlKey:true.
    let after_shift_released = Modifiers::from_keys(&["\u{E009}".to_string()]);
    let shift_up = key_event_js("keyup", "\u{E008}", after_shift_released);
    assert!(shift_up.contains("shiftKey:false"));
    assert!(shift_up.contains("ctrlKey:true"));
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
    assert_eq!(button_to_mask(5), 32);
    // Out-of-range index must not overflow the shift (panics in debug builds / under cargo test).
    assert_eq!(button_to_mask(32), 0);
    assert_eq!(button_to_mask(99), 0);
  }

  #[test]
  fn activation_events_per_button() {
    // Primary → click; middle/non-primary → auxclick; right → auxclick + contextmenu.
    assert_eq!(activation_events(0), &["click"]);
    assert_eq!(activation_events(1), &["auxclick"]);
    assert_eq!(activation_events(2), &["auxclick", "contextmenu"]);
    assert_eq!(activation_events(3), &["auxclick"]);
  }

  #[test]
  fn tick_count_is_the_max_actions_across_sources() {
    // The number of ticks is max(actions) across sources, so a shorter source contributes
    // nothing on later ticks while a longer one keeps going.
    let req = parse(
      r#"{"actions":[
        {"type":"key","id":"k","actions":[{"type":"keyDown","value":"a"}]},
        {"type":"pointer","id":"p","actions":[
          {"type":"pointerMove","x":0,"y":0},{"type":"pointerDown","button":0},{"type":"pointerUp","button":0}
        ]}
      ]}"#,
    );
    let ticks = req.actions.iter().map(ActionSequence::action_count).max().unwrap_or(0);
    assert_eq!(ticks, 3);
  }

  #[test]
  fn tick_duration_is_max_across_sources_not_sum() {
    // W3C §17.4.3: a tick lasts the max pause/move/scroll duration across sources, not their sum.
    let req = parse(
      r#"{"actions":[
        {"type":"none","id":"n","actions":[{"type":"pause","duration":100},{"type":"pause","duration":50}]},
        {"type":"pointer","id":"p","actions":[
          {"type":"pointerMove","x":0,"y":0,"duration":200},{"type":"pause","duration":30}
        ]},
        {"type":"wheel","id":"w","actions":[{"type":"scroll","x":0,"y":0,"deltaX":0,"deltaY":0,"duration":80}]}
      ]}"#,
    );
    let tick_ms = |tick: usize| req.actions.iter().filter_map(|s| s.duration_at(tick)).max().unwrap_or(0);
    // tick 0: max(100, 200, 80) = 200 — not the sum (380).
    assert_eq!(tick_ms(0), 200);
    // tick 1: max(50, 30) = 50 — the wheel source is exhausted and contributes nothing.
    assert_eq!(tick_ms(1), 50);
  }
}
