use std::collections::HashMap;

use serde_json::Value;
use uuid::Uuid;

/// W3C JSON key identifying a web element reference.
pub(crate) const ELEMENT_KEY: &str = "element-6066-11e4-a52e-4f735466cecf";
/// Each element's node is kept on `window` under this prefix and its ID without hyphens.
pub(crate) const ELEMENT_VAR_PREFIX: &str = "__wd_el_";
/// W3C JSON key identifying a shadow root reference.
pub(crate) const SHADOW_KEY: &str = "shadow-6066-11e4-a52e-4f735466cecf";

/// Represents a `WebDriver` element reference
#[derive(Debug, Clone)]
pub struct ElementRef {
  /// `WebDriver` element ID (returned to client)
  pub id: String,
  /// JavaScript variable name holding the element reference
  pub js_ref: String,
}

/// Storage for element references within a session
#[derive(Debug, Default)]
pub struct ElementStore {
  elements: HashMap<String, ElementRef>,
}

impl ElementStore {
  pub fn new() -> Self {
    Self { elements: HashMap::new() }
  }

  /// Store a new element and return its reference
  pub fn store(&mut self) -> ElementRef {
    self.insert(Uuid::new_v4().to_string())
  }

  /// Registers the references in a script result whose IDs the serialiser made from `ref_prefix`.
  pub fn register_script_refs(&mut self, result: &Value, ref_prefix: &str) {
    match result {
      Value::Array(items) => {
        for item in items {
          self.register_script_refs(item, ref_prefix);
        }
      }
      Value::Object(entries) => {
        for key in [ELEMENT_KEY, SHADOW_KEY] {
          if let Some(id) = entries.get(key).and_then(Value::as_str) {
            if is_script_ref_id(id, ref_prefix) {
              self.insert(id.to_string());
            }
          }
        }
        for value in entries.values() {
          self.register_script_refs(value, ref_prefix);
        }
      }
      _ => {}
    }
  }

  fn insert(&mut self, id: String) -> ElementRef {
    // Remove hyphens from the ID for a valid JS variable name
    let js_ref = format!("{ELEMENT_VAR_PREFIX}{}", id.replace('-', ""));
    let elem_ref = ElementRef { id: id.clone(), js_ref };
    self.elements.insert(id, elem_ref.clone());
    elem_ref
  }

  /// Get element by `WebDriver` ID
  pub fn get(&self, id: &str) -> Option<&ElementRef> {
    self.elements.get(id)
  }
}

/// The serialiser numbers the nodes in a result: `<ref_prefix>-0`, `<ref_prefix>-1`, and so on.
fn is_script_ref_id(id: &str, ref_prefix: &str) -> bool {
  id.strip_prefix(ref_prefix)
    .and_then(|rest| rest.strip_prefix('-'))
    .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
}

#[cfg(test)]
mod tests {
  use serde_json::json;

  use super::*;

  #[test]
  fn test_store_element() {
    let mut store = ElementStore::new();
    let elem = store.store();

    assert!(!elem.id.is_empty());
    assert!(elem.js_ref.starts_with("__wd_el_"));
    // js_ref uses ID without hyphens
    assert!(elem.js_ref.contains(&elem.id.replace('-', "")));
  }

  #[test]
  fn test_get_element() {
    let mut store = ElementStore::new();
    let elem = store.store();
    let id = elem.id.clone();

    let retrieved = store.get(&id).expect("element should exist");
    assert_eq!(retrieved.id, id);
  }

  #[test]
  fn test_js_ref_uses_id_without_hyphens() {
    let mut store = ElementStore::new();
    let elem1 = store.store();
    let elem2 = store.store();

    // js_ref should use ID with hyphens removed for valid JS variable name
    assert_eq!(elem1.js_ref, format!("__wd_el_{}", elem1.id.replace('-', "")));
    assert_eq!(elem2.js_ref, format!("__wd_el_{}", elem2.id.replace('-', "")));
  }

  #[test]
  fn registers_the_refs_a_script_result_carries_at_any_depth() {
    let mut store = ElementStore::new();
    let result = json!([
      { ELEMENT_KEY: "p-0" },
      { "nested": { "list": [{ SHADOW_KEY: "p-1" }] } },
    ]);

    store.register_script_refs(&result, "p");

    assert_eq!(store.get("p-0").map(|el| el.js_ref.as_str()), Some("__wd_el_p0"));
    assert_eq!(store.get("p-1").map(|el| el.js_ref.as_str()), Some("__wd_el_p1"));
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

    for id in ["other-0", "p-x", "p-", "p0", "p-2"] {
      assert!(store.get(id).is_none(), "{id} should not be registered");
    }
  }
}
