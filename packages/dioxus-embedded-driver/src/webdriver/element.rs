use std::collections::HashMap;

use uuid::Uuid;

/// Key used in WebDriver element references.
pub const ELEMENT_KEY: &str = "element-6066-11e4-a52e-4f735466cecf";

/// Stores element references (JS variable names) per session.
#[derive(Debug, Default)]
pub struct ElementStore {
  /// Maps element ID → the JS variable name storing the DOM node.
  elements: HashMap<String, String>,
}

impl ElementStore {
  pub fn new() -> Self {
    Self::default()
  }

  /// Store a new element reference and return its WebDriver element ID.
  pub fn insert(&mut self, js_var: String) -> String {
    let id = Uuid::new_v4().to_string();
    self.elements.insert(id.clone(), js_var);
    id
  }

  /// Total number of elements stored (used to generate unique JS var names).
  pub fn element_count(&self) -> usize {
    self.elements.len()
  }

  /// Look up the JS variable name for an element ID.
  pub fn get(&self, id: &str) -> Option<&str> {
    self.elements.get(id).map(String::as_str)
  }

  /// All JS variable names currently held by this store.
  pub fn all_vars(&self) -> Vec<String> {
    self.elements.values().cloned().collect()
  }

  /// Discard all element references. Called after full-page navigation so that
  /// stale element IDs are no longer resolvable Rust-side.
  pub fn clear(&mut self) {
    self.elements.clear();
  }

  /// Build the W3C element reference object for a given element ID.
  pub fn element_ref(id: &str) -> serde_json::Value {
    serde_json::json!({ ELEMENT_KEY: id })
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn should_round_trip_element_refs() {
    let mut store = ElementStore::new();
    let id = store.insert("__wdio_elem_0".into());
    assert_eq!(store.get(&id), Some("__wdio_elem_0"));
    assert!(store.get("no-such-id").is_none());
  }

  #[test]
  fn should_clear_all_refs() {
    let mut store = ElementStore::new();
    let id = store.insert("__wdio_elem_0".into());
    store.clear();
    assert!(store.get(&id).is_none());
    assert!(store.all_vars().is_empty());
  }
}
