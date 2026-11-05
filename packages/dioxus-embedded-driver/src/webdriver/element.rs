use std::collections::HashMap;

use serde_json::Value;
use uuid::Uuid;

/// Key used in WebDriver element references.
pub const ELEMENT_KEY: &str = "element-6066-11e4-a52e-4f735466cecf";
const SHADOW_KEY: &str = "shadow-6066-11e4-a52e-4f735466cecf";

/// A script result keeps each element's node on `window` under this prefix and its ID without hyphens.
/// Find Element and Find Elements use the prefix too, with variable names of their own.
pub const ELEMENT_VAR_PREFIX: &str = "__wdio_elem_";

/// Stores element references (JS variable names) per session.
#[derive(Debug, Default)]
pub struct ElementStore {
  /// Maps element ID → the JS variable name storing the DOM node.
  elements: HashMap<String, String>,
  /// Variables holding shadow roots from script results, kept only so session delete removes them.
  shadow_root_vars: Vec<String>,
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

  /// Registers the element references in a script result whose IDs the serialiser made from
  /// `ref_prefix`. A shadow root ID isn't registered until this driver has shadow root commands
  /// (#721), so element commands fail with `no such element` for it.
  pub fn register_script_refs(&mut self, result: &Value, ref_prefix: &str) {
    match result {
      Value::Array(items) => {
        for item in items {
          self.register_script_refs(item, ref_prefix);
        }
      }
      Value::Object(entries) => {
        if let Some(id) = entries.get(ELEMENT_KEY).and_then(Value::as_str) {
          if is_script_ref_id(id, ref_prefix) {
            self.elements.insert(id.to_string(), script_ref_var(id));
          }
        }
        if let Some(id) = entries.get(SHADOW_KEY).and_then(Value::as_str) {
          if is_script_ref_id(id, ref_prefix) {
            self.shadow_root_vars.push(script_ref_var(id));
          }
        }
        for value in entries.values() {
          self.register_script_refs(value, ref_prefix);
        }
      }
      _ => {}
    }
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
    self.elements.values().chain(&self.shadow_root_vars).cloned().collect()
  }

  /// Discard all element references. Called after full-page navigation so that
  /// stale element IDs are no longer resolvable Rust-side.
  pub fn clear(&mut self) {
    self.elements.clear();
    self.shadow_root_vars.clear();
  }

  /// Build the W3C element reference object for a given element ID.
  pub fn element_ref(id: &str) -> serde_json::Value {
    serde_json::json!({ ELEMENT_KEY: id })
  }
}

/// The serialiser numbers the nodes in a result: `<ref_prefix>-0`, `<ref_prefix>-1`, and so on.
fn is_script_ref_id(id: &str, ref_prefix: &str) -> bool {
  id.strip_prefix(ref_prefix)
    .and_then(|rest| rest.strip_prefix('-'))
    .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
}

// Where script-result-refs.js keeps the node for `id`
fn script_ref_var(id: &str) -> String {
  format!("{ELEMENT_VAR_PREFIX}{}", id.replace('-', ""))
}
#[cfg(test)]
mod tests {
  use serde_json::json;

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

  #[test]
  fn registers_the_refs_a_script_result_carries_at_any_depth() {
    let mut store = ElementStore::new();
    let result = json!([
      { ELEMENT_KEY: "p-0" },
      { "nested": { "list": [{ ELEMENT_KEY: "p-1" }] } },
    ]);

    store.register_script_refs(&result, "p");

    assert_eq!(store.get("p-0"), Some("__wdio_elem_p0"));
    assert_eq!(store.get("p-1"), Some("__wdio_elem_p1"));
  }

  #[test]
  fn skips_shadow_root_refs_as_there_are_no_shadow_root_commands() {
    let mut store = ElementStore::new();
    let result = json!([{ SHADOW_KEY: "p-0" }]);

    store.register_script_refs(&result, "p");

    assert!(store.get("p-0").is_none());
    assert_eq!(store.all_vars(), vec!["__wdio_elem_p0".to_string()]);
  }

  #[test]
  fn skips_refs_the_serialiser_did_not_make_for_this_result() {
    let mut store = ElementStore::new();
    let result = json!([
      { ELEMENT_KEY: "other-0" },
      { ELEMENT_KEY: "p-x" },
      { ELEMENT_KEY: "p-" },
      { ELEMENT_KEY: "p0" },
      { ELEMENT_KEY: 0 },
      { "id": "p-2" },
    ]);

    store.register_script_refs(&result, "p");

    assert!(store.all_vars().is_empty());
  }
}
