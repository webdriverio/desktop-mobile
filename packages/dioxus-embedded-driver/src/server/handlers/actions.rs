//! W3C Actions handler (`POST`/`DELETE /session/{id}/actions`).
//!
//! The embedded driver has no native input path: every command is JavaScript
//! run inside the webview through the bridge IPC channel. So pointer/key/wheel
//! actions are **synthesized as DOM events** (`MouseEvent`/`KeyboardEvent`/
//! `WheelEvent`) dispatched on the element under the resolved coordinates,
//! matching what a real browser produces for input.
//!
//! Pointer `origin` resolution (`viewport` / `pointer` / element-center via
//! `getBoundingClientRect`) is handled up front so `element.click(options)` —
//! which WDIO sends as a `pointerMove` with an element origin and x/y defaulting
//! to 0 — lands on the element's center rather than viewport `(0, 0)`.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Path, State};
use axum::Json;
use serde::Deserialize;
use serde_json::Value;
use tokio::sync::oneshot;
use uuid::Uuid;

use super::element::ELEMENT_EVENTS_JS;
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
        Some(PointerAction::PointerMove { duration, .. })
        | Some(PointerAction::Pause { duration }) => *duration,
        _ => None,
      },
      ActionSequence::Wheel { actions, .. } => match actions.get(tick) {
        Some(WheelAction::Scroll { duration, .. }) | Some(WheelAction::Pause { duration }) => {
          *duration
        }
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
  let arr = value.as_array().ok_or_else(|| {
    WebDriverErrorResponse::unknown_error("expected [x, y] from element-center eval")
  })?;
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
fn pointer_event_js(
  event_type: &str,
  x: i32,
  y: i32,
  button: u32,
  buttons: u32,
  mods: Modifiers,
) -> String {
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
    format!(
      "ctrlKey:{},shiftKey:{},altKey:{},metaKey:{}",
      self.ctrl, self.shift, self.alt, self.meta
    )
  }
}

// The key tables are copies of tauri-plugin-wdio-webdriver's, since a published crate can only
// include its own files. test/scripts/key-tables.spec.ts checks the copies match.

/// Maps every WebDriver special-key value (U+E000–U+E05D) to `(key, code, keyCode)` per the W3C
/// tables and a US keyboard. A newline and a backspace character also press the Enter and
/// Backspace keys.
fn map_special_key(key: &str) -> Option<(&'static str, &'static str, u32)> {
  let mapped = match single_char(key)? {
    '\n' => ("Enter", "Enter", 13),
    '\u{8}' => ("Backspace", "Backspace", 8),
    '\u{E000}' => ("Unidentified", "", 0),
    '\u{E001}' => ("Cancel", "", 3),
    '\u{E002}' => ("Help", "Help", 47),
    '\u{E003}' => ("Backspace", "Backspace", 8),
    '\u{E004}' => ("Tab", "Tab", 9),
    '\u{E005}' => ("Clear", "", 12),
    // The spec's code table puts the main Enter key on U+E006 ("Return") and NumpadEnter on
    // U+E007, but clients send U+E007 for Enter, so it keeps the main key's code.
    '\u{E006}' => ("Enter", "NumpadEnter", 13),
    '\u{E007}' => ("Enter", "Enter", 13),
    '\u{E008}' => ("Shift", "ShiftLeft", 16),
    '\u{E009}' => ("Control", "ControlLeft", 17),
    '\u{E00A}' => ("Alt", "AltLeft", 18),
    '\u{E00B}' => ("Pause", "Pause", 19),
    '\u{E00C}' => ("Escape", "Escape", 27),
    '\u{E00D}' => (" ", "Space", 32),
    '\u{E00E}' => ("PageUp", "PageUp", 33),
    '\u{E00F}' => ("PageDown", "PageDown", 34),
    '\u{E010}' => ("End", "End", 35),
    '\u{E011}' => ("Home", "Home", 36),
    '\u{E012}' => ("ArrowLeft", "ArrowLeft", 37),
    '\u{E013}' => ("ArrowUp", "ArrowUp", 38),
    '\u{E014}' => ("ArrowRight", "ArrowRight", 39),
    '\u{E015}' => ("ArrowDown", "ArrowDown", 40),
    '\u{E016}' => ("Insert", "Insert", 45),
    '\u{E017}' => ("Delete", "Delete", 46),
    // The spec's code table has no row for U+E018; this is the US-layout `;` key.
    '\u{E018}' => (";", "Semicolon", 186),
    '\u{E019}' => ("=", "NumpadEqual", 187),
    '\u{E01A}' => ("0", "Numpad0", 96),
    '\u{E01B}' => ("1", "Numpad1", 97),
    '\u{E01C}' => ("2", "Numpad2", 98),
    '\u{E01D}' => ("3", "Numpad3", 99),
    '\u{E01E}' => ("4", "Numpad4", 100),
    '\u{E01F}' => ("5", "Numpad5", 101),
    '\u{E020}' => ("6", "Numpad6", 102),
    '\u{E021}' => ("7", "Numpad7", 103),
    '\u{E022}' => ("8", "Numpad8", 104),
    '\u{E023}' => ("9", "Numpad9", 105),
    '\u{E024}' => ("*", "NumpadMultiply", 106),
    '\u{E025}' => ("+", "NumpadAdd", 107),
    '\u{E026}' => (",", "NumpadComma", 108),
    '\u{E027}' => ("-", "NumpadSubtract", 109),
    '\u{E028}' => (".", "NumpadDecimal", 110),
    '\u{E029}' => ("/", "NumpadDivide", 111),
    '\u{E031}' => ("F1", "F1", 112),
    '\u{E032}' => ("F2", "F2", 113),
    '\u{E033}' => ("F3", "F3", 114),
    '\u{E034}' => ("F4", "F4", 115),
    '\u{E035}' => ("F5", "F5", 116),
    '\u{E036}' => ("F6", "F6", 117),
    '\u{E037}' => ("F7", "F7", 118),
    '\u{E038}' => ("F8", "F8", 119),
    '\u{E039}' => ("F9", "F9", 120),
    '\u{E03A}' => ("F10", "F10", 121),
    '\u{E03B}' => ("F11", "F11", 122),
    '\u{E03C}' => ("F12", "F12", 123),
    '\u{E03D}' => ("Meta", "MetaLeft", 91),
    '\u{E040}' => ("ZenkakuHankaku", "", 0),
    '\u{E050}' => ("Shift", "ShiftRight", 16),
    '\u{E051}' => ("Control", "ControlRight", 17),
    '\u{E052}' => ("Alt", "AltRight", 18),
    '\u{E053}' => ("Meta", "MetaRight", 92),
    '\u{E054}' => ("PageUp", "Numpad9", 33),
    '\u{E055}' => ("PageDown", "Numpad3", 34),
    '\u{E056}' => ("End", "Numpad1", 35),
    '\u{E057}' => ("Home", "Numpad7", 36),
    '\u{E058}' => ("ArrowLeft", "Numpad4", 37),
    '\u{E059}' => ("ArrowUp", "Numpad8", 38),
    '\u{E05A}' => ("ArrowRight", "Numpad6", 39),
    '\u{E05B}' => ("ArrowDown", "Numpad2", 40),
    '\u{E05C}' => ("Insert", "Numpad0", 45),
    '\u{E05D}' => ("Delete", "NumpadDecimal", 46),
    // Code points the spec leaves unassigned still dispatch as a key rather than as text.
    '\u{E000}'..='\u{E05D}' => ("Unidentified", "", 0),
    _ => return None, // printable character
  };
  Some(mapped)
}

/// A printable character's US-keyboard key: its `code`, its legacy `keyCode` (65 for `a` and `A`)
/// and whether it takes Shift, or `("", 0, false)` for a character the keyboard has no key for.
fn regular_key(key: &str) -> (String, u32, bool) {
  single_char(key).and_then(us_keyboard_key).unwrap_or_default()
}

/// Whether a key value presses no key: chromedriver skips a carriage return, so a `\r\n` line
/// ending presses Enter once.
fn is_skipped_key(key: &str) -> bool {
  key == "\r"
}

fn single_char(key: &str) -> Option<char> {
  let mut chars = key.chars();
  match (chars.next(), chars.next()) {
    (Some(ch), None) => Some(ch),
    _ => None,
  }
}

/// The `(code, keyCode, shifted)` of the US-keyboard key that types `ch`.
fn us_keyboard_key(ch: char) -> Option<(String, u32, bool)> {
  if ch.is_ascii_alphabetic() {
    let upper = ch.to_ascii_uppercase();
    return Some((format!("Key{upper}"), upper as u32, ch.is_ascii_uppercase()));
  }
  if ch.is_ascii_digit() {
    return Some((format!("Digit{ch}"), ch as u32, false));
  }
  let (code, key_code, shifted) = match ch {
    // Workaround for #889; drop once Tab moves focus
    '\t' => ("Tab", 9, false),
    ' ' => ("Space", 32, false),
    ')' => ("Digit0", 48, true),
    '!' => ("Digit1", 49, true),
    '@' => ("Digit2", 50, true),
    '#' => ("Digit3", 51, true),
    '$' => ("Digit4", 52, true),
    '%' => ("Digit5", 53, true),
    '^' => ("Digit6", 54, true),
    '&' => ("Digit7", 55, true),
    '*' => ("Digit8", 56, true),
    '(' => ("Digit9", 57, true),
    ';' => ("Semicolon", 186, false),
    ':' => ("Semicolon", 186, true),
    '=' => ("Equal", 187, false),
    '+' => ("Equal", 187, true),
    ',' => ("Comma", 188, false),
    '<' => ("Comma", 188, true),
    '-' => ("Minus", 189, false),
    '_' => ("Minus", 189, true),
    '.' => ("Period", 190, false),
    '>' => ("Period", 190, true),
    '/' => ("Slash", 191, false),
    '?' => ("Slash", 191, true),
    '`' => ("Backquote", 192, false),
    '~' => ("Backquote", 192, true),
    '[' => ("BracketLeft", 219, false),
    '{' => ("BracketLeft", 219, true),
    '\\' => ("Backslash", 220, false),
    '|' => ("Backslash", 220, true),
    ']' => ("BracketRight", 221, false),
    '}' => ("BracketRight", 221, true),
    '\'' => ("Quote", 222, false),
    '"' => ("Quote", 222, true),
    _ => return None,
  };
  Some((code.to_string(), key_code, shifted))
}

/// JS that dispatches a `KeyboardEvent` with the `key`, `code`, `keyCode` and Shift a browser sends
/// to the focused element, looking through open shadow roots. An uncanceled Enter keydown in an
/// input also fires its pending `change` and submits its form.
fn key_event_js(event_type: &str, value: &str, mods: Modifiers) -> String {
  let (key, code, key_code, mods) = match map_special_key(value) {
    Some((key, code, key_code)) => (key, code.to_string(), key_code, mods),
    None => {
      let (code, key_code, shifted) = regular_key(value);
      (value, code, key_code, Modifiers { shift: mods.shift || shifted, ..mods })
    }
  };
  let modifiers = mods.js();
  let enter = if event_type == "keydown" && key == "Enter" && !(mods.ctrl || mods.meta || mods.alt)
  {
    format!(
      "if(!e.defaultPrevented){{\n{ELEMENT_EVENTS_JS}\nwdioCommitOnEnter(t); wdioSubmitOnEnter(t); }}"
    )
  } else {
    String::new()
  };
  format!(
    "(function(){{ var t=document.activeElement||document.body; if(!t) return; while(t.shadowRoot&&t.shadowRoot.activeElement){{t=t.shadowRoot.activeElement;}} var e=new KeyboardEvent({event_type:?},{{bubbles:true,cancelable:true,composed:true,key:{key:?},code:{code:?},keyCode:{key_code},which:{key_code},{modifiers}}}); t.dispatchEvent(e); {enter}}})(); null"
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
    let mask = session
      .action_state
      .pressed_buttons
      .values()
      .flatten()
      .fold(0u32, |m, b| m | button_to_mask(*b));
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
    let tick_duration_ms =
      request.actions.iter().filter_map(|seq| seq.duration_at(tick)).max().unwrap_or(0);
    for action_seq in &request.actions {
      match action_seq {
        ActionSequence::Key { _id: _, actions } => {
          if let Some(action) = actions.get(tick) {
            match action {
              KeyAction::KeyDown { value } | KeyAction::KeyUp { value }
                if is_skipped_key(value) => {}
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
                  pointer_event_js(
                    "mousedown",
                    pointer_state.x,
                    pointer_state.y,
                    *button,
                    held_mask,
                    modifiers,
                  ),
                  timeout_ms,
                )
                .await?;
                down_pos.insert(*button, (pointer_state.x, pointer_state.y));
                let mut sessions = state.sessions.write().await;
                if let Ok(session) = sessions.get_mut(&session_id) {
                  session
                    .action_state
                    .pressed_buttons
                    .entry(id.clone())
                    .or_default()
                    .insert(*button);
                }
              }
              PointerAction::PointerUp { button } => {
                held_mask &= !button_to_mask(*button);
                eval(
                  pointer_event_js(
                    "mouseup",
                    pointer_state.x,
                    pointer_state.y,
                    *button,
                    held_mask,
                    modifiers,
                  ),
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
                    eval(
                      pointer_event_js(event_type, pos.0, pos.1, *button, 0, modifiers),
                      timeout_ms,
                    )
                    .await?;
                  }
                  // A second primary click on the same spot completes a double-click — emit `dblclick`
                  // (what element.doubleClick()'s two press/release pairs should produce).
                  if *button == 0 {
                    if last_click_pos == Some(pos) {
                      eval(
                        pointer_event_js("dblclick", pos.0, pos.1, *button, 0, modifiers),
                        timeout_ms,
                      )
                      .await?;
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
                  resolve_origin(&state, &session_id, origin, *x, *y, &pointer_state, timeout_ms)
                    .await?;
                pointer_state.x = target_x;
                pointer_state.y = target_y;
                // A move between clicks breaks a double-click chain. element.doubleClick() never moves
                // between its two press/release pairs, so this can't suppress a legitimate dblclick.
                last_click_pos = None;
                eval(
                  pointer_event_js(
                    "mousemove",
                    pointer_state.x,
                    pointer_state.y,
                    0,
                    held_mask,
                    modifiers,
                  ),
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
    eval(
      pointer_event_js(
        "mouseup",
        pointer_pos.0,
        pointer_pos.1,
        button,
        held_mask,
        Modifiers::default(),
      ),
      timeout_ms,
    )
    .await?;
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
  fn key_event_js_uses_the_deep_active_element() {
    let js = key_event_js("keydown", "Enter", Modifiers::default());
    let active = js.find("var t=document.activeElement").unwrap();
    let deep = js.find("t=t.shadowRoot.activeElement;").unwrap();
    let dispatch = js.find("t.dispatchEvent(e);").unwrap();
    assert!(active < deep && deep < dispatch);
    assert!(js.contains("KeyboardEvent(\"keydown\""));
    assert!(js.contains("key:\"Enter\""));
  }

  #[test]
  fn key_event_js_commits_an_inputs_change_then_submits_its_form_on_an_uncanceled_enter_keydown() {
    let m = Modifiers::default();
    let enter = key_event_js("keydown", "\u{E007}", m);
    let dispatch = enter.find("t.dispatchEvent(e);").unwrap();
    let canceled = enter.find("if(!e.defaultPrevented){").unwrap();
    let commit = enter.find("wdioCommitOnEnter(t);").unwrap();
    let submit = enter.find("wdioSubmitOnEnter(t);").unwrap();
    assert!(dispatch < canceled && canceled < commit && commit < submit);
    assert!(enter.contains(ELEMENT_EVENTS_JS));
    let shift = Modifiers { shift: true, ..m };
    let shift_enter = key_event_js("keydown", "\u{E006}", shift);
    assert!(shift_enter.contains("wdioCommitOnEnter(t);"));
    assert!(shift_enter.contains("wdioSubmitOnEnter(t);"));
    let ctrl = Modifiers { ctrl: true, ..m };
    for js in [
      key_event_js("keyup", "\u{E007}", m),
      key_event_js("keydown", "\u{E007}", ctrl),
      key_event_js("keydown", "a", m),
    ] {
      assert!(!js.contains("wdioCommitOnEnter") && !js.contains("wdioSubmitOnEnter"), "{js}");
    }
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
  fn every_special_key_code_point_maps_to_a_named_key() {
    let special_keys = '\u{E000}'..='\u{E05D}';
    for ch in special_keys.clone() {
      let (key, code, _) = map_special_key(&ch.to_string())
        .unwrap_or_else(|| panic!("U+{:04X} has no mapping", ch as u32));
      assert!(
        !key.chars().chain(code.chars()).any(|c| special_keys.contains(&c)),
        "U+{:04X} maps to a private-use value",
        ch as u32
      );
    }
  }

  #[test]
  fn map_special_key_sends_each_keys_code_and_key_code() {
    for (value, expected) in [
      ("\u{E00F}", ("PageDown", "PageDown", 34)),
      ("\u{E011}", ("Home", "Home", 36)),
      ("\u{E007}", ("Enter", "Enter", 13)),
      ("\u{E006}", ("Enter", "NumpadEnter", 13)),
      ("\u{E00D}", (" ", "Space", 32)),
      ("\u{E01B}", ("1", "Numpad1", 97)),
      ("\u{E031}", ("F1", "F1", 112)),
      ("\u{E053}", ("Meta", "MetaRight", 92)),
      ("\u{E05D}", ("Delete", "NumpadDecimal", 46)),
      ("\u{E000}", ("Unidentified", "", 0)),
      ("\u{E02A}", ("Unidentified", "", 0)),
    ] {
      assert_eq!(map_special_key(value), Some(expected), "{value:?}");
    }
    for value in ["a", "5", "", "\u{E05E}", "\u{E00F}\u{E00F}"] {
      assert_eq!(map_special_key(value), None, "{value:?}");
    }
  }

  #[test]
  fn regular_keys_send_their_us_keyboard_key() {
    for (key, (code, key_code, shifted)) in [
      ("a", ("KeyA", 65, false)),
      ("A", ("KeyA", 65, true)),
      ("p", ("KeyP", 80, false)),
      ("z", ("KeyZ", 90, false)),
      ("0", ("Digit0", 48, false)),
      ("5", ("Digit5", 53, false)),
      ("%", ("Digit5", 53, true)),
      ("!", ("Digit1", 49, true)),
      (")", ("Digit0", 48, true)),
      (" ", ("Space", 32, false)),
      (";", ("Semicolon", 186, false)),
      (":", ("Semicolon", 186, true)),
      ("=", ("Equal", 187, false)),
      ("+", ("Equal", 187, true)),
      (",", ("Comma", 188, false)),
      ("-", ("Minus", 189, false)),
      (".", ("Period", 190, false)),
      ("/", ("Slash", 191, false)),
      ("?", ("Slash", 191, true)),
      ("`", ("Backquote", 192, false)),
      ("~", ("Backquote", 192, true)),
      ("[", ("BracketLeft", 219, false)),
      ("\\", ("Backslash", 220, false)),
      ("\t", ("Tab", 9, false)),
      ("]", ("BracketRight", 221, false)),
      ("'", ("Quote", 222, false)),
      ("\"", ("Quote", 222, true)),
      ("é", ("", 0, false)),
      ("ab", ("", 0, false)),
    ] {
      assert_eq!(regular_key(key), (code.to_string(), key_code, shifted), "{key:?}");
    }
  }

  #[test]
  fn letters_dont_share_numpad_or_function_key_codes() {
    let special_codes: Vec<u32> = ('\u{E000}'..='\u{E05D}')
      .filter_map(|ch| map_special_key(&ch.to_string()))
      .map(|(_, _, key_code)| key_code)
      .collect();
    for ch in ('a'..='z').chain('A'..='Z') {
      let (_, key_code, _) = regular_key(&ch.to_string());
      assert!(
        !special_codes.contains(&key_code),
        "{ch} shares keyCode {key_code} with a special key"
      );
    }
  }

  #[test]
  fn key_event_js_sends_the_key_code_and_shift_a_browser_sends() {
    let m = Modifiers::default();
    for (value, expected) in [
      ("a", r#"key:"a",code:"KeyA",keyCode:65,which:65,ctrlKey:false,shiftKey:false"#),
      ("A", r#"key:"A",code:"KeyA",keyCode:65,which:65,ctrlKey:false,shiftKey:true"#),
      ("!", r#"key:"!",code:"Digit1",keyCode:49,which:49,ctrlKey:false,shiftKey:true"#),
      ("é", r#"key:"é",code:"",keyCode:0,which:0,ctrlKey:false,shiftKey:false"#),
      ("\u{E00F}", r#"key:"PageDown",code:"PageDown",keyCode:34,which:34,"#),
      ("\u{E01B}", r#"key:"1",code:"Numpad1",keyCode:97,which:97,"#),
    ] {
      let js = key_event_js("keydown", value, m);
      assert!(js.contains(expected), "{value:?}: {js}");
    }
    let ctrl = Modifiers { ctrl: true, ..m };
    assert!(key_event_js("keydown", "!", ctrl).contains("ctrlKey:true,shiftKey:true"));
  }

  #[test]
  fn control_characters_press_the_keys_chromedriver_sends() {
    let m = Modifiers::default();
    assert_eq!(map_special_key("\n"), map_special_key("\u{E007}"));
    assert_eq!(map_special_key("\u{8}"), map_special_key("\u{E003}"));
    assert!(is_skipped_key("\r") && map_special_key("\r").is_none());
    let newline = key_event_js("keydown", "\n", m);
    assert!(newline.contains(r#"key:"Enter",code:"Enter",keyCode:13,"#), "{newline}");
    assert!(newline.contains("wdioCommitOnEnter(t);"));
    let backspace = key_event_js("keydown", "\u{8}", m);
    assert!(backspace.contains(r#"key:"Backspace",code:"Backspace",keyCode:8,"#), "{backspace}");
    let tab = key_event_js("keydown", "\t", m);
    assert!(tab.contains(r#"key:"\t",code:"Tab",keyCode:9,"#), "{tab}");
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
    let tick_ms =
      |tick: usize| req.actions.iter().filter_map(|s| s.duration_at(tick)).max().unwrap_or(0);
    // tick 0: max(100, 200, 80) = 200 — not the sum (380).
    assert_eq!(tick_ms(0), 200);
    // tick 1: max(50, 30) = 50 — the wheel source is exhausted and contributes nothing.
    assert_eq!(tick_ms(1), 50);
  }
}
