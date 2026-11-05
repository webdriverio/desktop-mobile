use std::collections::{HashMap, HashSet};

use serde::Serialize;
use uuid::Uuid;

use crate::server::response::WebDriverErrorResponse;
use crate::webdriver::element::ElementStore;

/// Session timeouts (milliseconds).
#[derive(Debug, Clone, Serialize)]
#[allow(clippy::struct_field_names)]
pub struct Timeouts {
  pub implicit_ms: u64,
  pub page_load_ms: u64,
  pub script_ms: u64,
}

impl Default for Timeouts {
  fn default() -> Self {
    Self { implicit_ms: 0, page_load_ms: 300_000, script_ms: 30_000 }
  }
}

// The press tracking is the same in both embedded drivers; test/scripts/key-tables.spec.ts checks
// the copies match.
/// A held key or pointer button.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Press {
  Key(String),
  Button { source_id: String, button: u32 },
}

impl Press {
  pub fn key(&self) -> Option<&String> {
    match self {
      Press::Key(key) => Some(key),
      Press::Button { .. } => None,
    }
  }
}

/// Input state carried across W3C Actions calls within a session.
///
/// The pointer position persists so a later `performActions` with
/// `origin: "pointer"` resolves relative to it instead of `(0, 0)`, and the
/// pressed keys/buttons let `releaseActions` (DELETE) emit the matching
/// `keyUp`/`pointerUp` events that the test never explicitly sent.
#[derive(Debug, Default)]
pub struct ActionState {
  pub pointer_position: (i32, i32),
  /// Held keys and pointer buttons, in the order they were pressed.
  presses: Vec<Press>,
  /// Pressed pointer buttons keyed by the action source's `id`.
  pub pressed_buttons: HashMap<String, HashSet<u32>>,
}

impl ActionState {
  /// A key pressed again while held moves to the end, as W3C releases its latest press first.
  pub fn press_key(&mut self, key: &str) {
    self.release_key(key);
    self.presses.push(Press::Key(key.to_string()));
  }

  pub fn release_key(&mut self, key: &str) {
    self.presses.retain(|press| !matches!(press, Press::Key(held) if held == key));
  }

  /// The held keys, in the order they were pressed.
  pub fn pressed_keys(&self) -> impl Iterator<Item = &String> {
    self.presses.iter().filter_map(Press::key)
  }

  /// Takes the held keys and buttons, latest press first, which is W3C's release order. Keys are
  /// forgotten here; buttons stay in `pressed_buttons` until the caller releases them.
  pub fn take_presses_to_release(&mut self) -> Vec<Press> {
    let mut presses = std::mem::take(&mut self.presses);
    presses.reverse();
    presses
  }

  fn forget_button_press(&mut self, source_id: &str, button: u32) {
    self.presses.retain(|press| {
      !matches!(press, Press::Button { source_id: held, button: held_button }
        if held == source_id && *held_button == button)
    });
  }

  pub fn press_button(&mut self, source_id: &str, button: u32) {
    if self.pressed_buttons.entry(source_id.to_string()).or_default().insert(button) {
      self.presses.push(Press::Button { source_id: source_id.to_string(), button });
    }
  }

  pub fn release_button(&mut self, source_id: &str, button: u32) {
    if let Some(held) = self.pressed_buttons.get_mut(source_id) {
      held.remove(&button);
    }
    self.forget_button_press(source_id, button);
  }

  /// Forgets every button `source_id` holds, returning them.
  pub fn cancel_buttons(&mut self, source_id: &str) -> HashSet<u32> {
    self
      .presses
      .retain(|press| !matches!(press, Press::Button { source_id: held, .. } if held == source_id));
    self.pressed_buttons.remove(source_id).unwrap_or_default()
  }
}

/// A WebDriver session.
#[derive(Debug)]
pub struct Session {
  pub id: String,
  pub timeouts: Timeouts,
  pub elements: ElementStore,
  /// Label of the currently-active Dioxus window.
  pub current_window: String,
  pub action_state: ActionState,
}

impl Session {
  pub fn new(initial_window: String) -> Self {
    Self {
      id: Uuid::new_v4().to_string(),
      timeouts: Timeouts::default(),
      elements: ElementStore::new(),
      current_window: initial_window,
      action_state: ActionState::default(),
    }
  }
}

/// Manages WebDriver sessions.
#[derive(Debug, Default)]
pub struct SessionManager {
  sessions: HashMap<String, Session>,
}

impl SessionManager {
  pub fn new() -> Self {
    Self::default()
  }

  pub fn create(&mut self, initial_window: String) -> &Session {
    let session = Session::new(initial_window);
    let id = session.id.clone();
    self.sessions.insert(id.clone(), session);
    self.sessions.get(&id).expect("just inserted")
  }

  pub fn get(&self, id: &str) -> Result<&Session, WebDriverErrorResponse> {
    self.sessions.get(id).ok_or_else(|| WebDriverErrorResponse::invalid_session_id(id))
  }

  pub fn get_mut(&mut self, id: &str) -> Result<&mut Session, WebDriverErrorResponse> {
    self.sessions.get_mut(id).ok_or_else(|| WebDriverErrorResponse::invalid_session_id(id))
  }

  pub fn delete(&mut self, id: &str) -> bool {
    self.sessions.remove(id).is_some()
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn key(key: &str) -> Press {
    Press::Key(key.to_string())
  }

  fn button(source_id: &str, button: u32) -> Press {
    Press::Button { source_id: source_id.to_string(), button }
  }

  #[test]
  fn release_actions_releases_keys_in_reverse_press_order() {
    let mut state = ActionState::default();
    for key in [" ", "\u{E009}", "a", " "] {
      state.press_key(key);
    }
    state.release_key("a");
    assert!(state.pressed_keys().eq(["\u{E009}", " "]));
    assert_eq!(state.take_presses_to_release(), [key(" "), key("\u{E009}")]);
    assert_eq!(state.pressed_keys().count(), 0);
  }

  #[test]
  fn release_actions_releases_keys_and_buttons_in_one_reverse_press_order() {
    let mut state = ActionState::default();
    state.press_key("\u{E008}");
    state.press_button("mouse", 0);
    state.press_key("\u{E009}");
    state.press_button("mouse", 2);
    state.release_button("mouse", 2);
    state.press_button("pen", 0);
    state.press_button("pen", 0);

    let release = state.take_presses_to_release();

    assert_eq!(release, [button("pen", 0), key("\u{E009}"), button("mouse", 0), key("\u{E008}")]);
  }

  #[test]
  fn canceling_a_source_releases_only_its_buttons() {
    let mut state = ActionState::default();
    state.press_button("mouse", 0);
    state.press_key("\u{E008}");
    state.press_button("mouse", 2);
    state.press_button("pen", 0);

    assert_eq!(state.cancel_buttons("mouse"), [0, 2].into());

    assert!(!state.pressed_buttons.contains_key("mouse"));
    assert_eq!(state.take_presses_to_release(), [button("pen", 0), key("\u{E008}")]);
  }

  #[test]
  fn should_create_sessions_with_unique_ids() {
    let mut mgr = SessionManager::new();
    let a = mgr.create("main".into()).id.clone();
    let b = mgr.create("main".into()).id.clone();
    assert_ne!(a, b);
  }

  #[test]
  fn should_delete_sessions() {
    let mut mgr = SessionManager::new();
    let id = mgr.create("main".into()).id.clone();
    assert!(mgr.delete(&id));
    assert!(!mgr.delete(&id));
  }

  #[test]
  fn should_return_error_for_unknown_session() {
    let mgr = SessionManager::new();
    assert!(mgr.get("no-such-id").is_err());
  }
}
