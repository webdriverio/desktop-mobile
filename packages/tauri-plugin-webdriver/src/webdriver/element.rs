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

  /// Registers the IDs [`script_ref_ids`] found in a script result.
  pub fn register_script_refs(&mut self, ids: &[&str]) {
    for id in ids {
      self.insert((*id).to_string());
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

/// The IDs, at any depth, of the references in a script result that the serialiser made from
/// `ref_prefix`.
pub fn script_ref_ids<'a>(result: &'a Value, ref_prefix: &str) -> Vec<&'a str> {
  let mut ids = Vec::new();
  collect_script_ref_ids(result, ref_prefix, &mut ids);
  ids
}

fn collect_script_ref_ids<'a>(result: &'a Value, ref_prefix: &str, ids: &mut Vec<&'a str>) {
  match result {
    Value::Array(items) => {
      for item in items {
        collect_script_ref_ids(item, ref_prefix, ids);
      }
    }
    Value::Object(entries) => {
      for key in [ELEMENT_KEY, SHADOW_KEY] {
        if let Some(id) = entries.get(key).and_then(Value::as_str) {
          if is_script_ref_id(id, ref_prefix) {
            ids.push(id);
          }
        }
      }
      for value in entries.values() {
        collect_script_ref_ids(value, ref_prefix, ids);
      }
    }
    _ => {}
  }
}

/// The ID prefix for one attempt at a script. A retry gets its own, so a late report from an
/// earlier attempt can't point at the retry's nodes.
#[cfg(any(target_os = "macos", test))]
pub fn attempt_ref_prefix(ref_prefix: &str, attempt: usize) -> String {
  debug_assert!(attempt < 10, "dropping hyphens would give attempts 1 and 11 shared variables");
  if attempt == 0 {
    ref_prefix.to_string()
  } else {
    format!("{ref_prefix}_{attempt}")
  }
}

/// The serialiser numbers the nodes in a result `<prefix>-0`, `<prefix>-1` and so on, where
/// `<prefix>` is `ref_prefix`, or `<ref_prefix>_<attempt>` for a retry.
fn is_script_ref_id(id: &str, ref_prefix: &str) -> bool {
  let Some(rest) = id.strip_prefix(ref_prefix) else {
    return false;
  };
  let number = match rest.strip_prefix('_') {
    Some(attempt_and_number) => attempt_and_number
      .split_once('-')
      .filter(|(attempt, _)| is_number(attempt))
      .map(|(_, number)| number),
    None => rest.strip_prefix('-'),
  };
  number.is_some_and(is_number)
}

fn is_number(s: &str) -> bool {
  !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
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

    store.register_script_refs(&script_ref_ids(&result, "p"));

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

    store.register_script_refs(&script_ref_ids(&result, "p"));

    for id in ["other-0", "p-x", "p-", "p0", "p-2"] {
      assert!(store.get(id).is_none(), "{id} should not be registered");
    }
  }

  #[test]
  fn registers_the_refs_of_a_script_run_again_under_their_own_variables() {
    let mut store = ElementStore::new();
    let first = attempt_ref_prefix("p", 0);
    let retry = attempt_ref_prefix("p", 1);
    let result =
      json!([{ ELEMENT_KEY: format!("{first}-0") }, { ELEMENT_KEY: format!("{retry}-0") }]);

    store.register_script_refs(&script_ref_ids(&result, "p"));

    assert_eq!(store.get("p-0").map(|el| el.js_ref.as_str()), Some("__wd_el_p0"));
    assert_eq!(store.get("p_1-0").map(|el| el.js_ref.as_str()), Some("__wd_el_p_10"));
  }

  #[test]
  fn skips_malformed_attempt_ids() {
    let mut store = ElementStore::new();
    let result = json!([
      { ELEMENT_KEY: "p_-0" },
      { ELEMENT_KEY: "p_x-0" },
      { ELEMENT_KEY: "p_1-" },
      { ELEMENT_KEY: "p_1" },
      { ELEMENT_KEY: "p_1-0-0" },
    ]);

    store.register_script_refs(&script_ref_ids(&result, "p"));

    for id in ["p_-0", "p_x-0", "p_1-", "p_1", "p_1-0-0"] {
      assert!(store.get(id).is_none(), "{id} should not be registered");
    }
  }

  #[test]
  fn lists_the_ref_ids_a_script_result_carries() {
    let result = json!({ "a": { ELEMENT_KEY: "p-0" }, "b": [{ ELEMENT_KEY: "other-0" }], "c": 1 });

    assert_eq!(script_ref_ids(&result, "p"), vec!["p-0"]);
    assert!(script_ref_ids(&json!({ "value": 1 }), "p").is_empty());
  }
}
