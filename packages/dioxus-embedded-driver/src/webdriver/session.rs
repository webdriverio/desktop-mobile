use std::collections::HashMap;

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
    Self {
      implicit_ms: 0,
      page_load_ms: 300_000,
      script_ms: 30_000,
    }
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
}

impl Session {
  pub fn new(initial_window: String) -> Self {
    Self {
      id: Uuid::new_v4().to_string(),
      timeouts: Timeouts::default(),
      elements: ElementStore::new(),
      current_window: initial_window,
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
