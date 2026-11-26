//! The parts of reading a WebView2 script result that don't touch COM, so tests run on every platform.

use serde_json::Value;

/// A script's result as JSON, or as the raw text when it isn't JSON.
pub(crate) fn parse_script_json(json_str: String) -> Value {
  serde_json::from_str(&json_str).unwrap_or(Value::String(json_str))
}

/// The text to report for a script exception: its message, else its name, else its JSON.
pub(crate) fn exception_text(
  message: Option<String>,
  name: impl FnOnce() -> Option<String>,
  json: impl FnOnce() -> Option<String>,
) -> String {
  message
    .filter(|text| !text.is_empty())
    .or_else(|| name().filter(|text| !text.is_empty()))
    .or_else(json)
    .unwrap_or_else(|| "Script threw an exception".to_string())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn parse_script_json_reads_json_and_keeps_other_text() {
    assert_eq!(parse_script_json(r#"{"a":1}"#.to_string()), serde_json::json!({ "a": 1 }));
    assert_eq!(parse_script_json("not json".to_string()), Value::String("not json".to_string()));
  }

  #[test]
  fn exception_text_prefers_the_message() {
    let text = exception_text(
      Some("boom".to_string()),
      || panic!("the name is read only without a message"),
      || panic!("the JSON is read only without a message or name"),
    );
    assert_eq!(text, "boom");
  }

  #[test]
  fn exception_text_falls_back_to_the_name_then_the_json() {
    let name = || Some("TypeError".to_string());
    let json = || Some(r#"{"name":"TypeError"}"#.to_string());
    assert_eq!(exception_text(Some(String::new()), name, json), "TypeError");
    assert_eq!(exception_text(None, || Some(String::new()), json), r#"{"name":"TypeError"}"#);
  }

  #[test]
  fn exception_text_has_a_default_when_nothing_can_be_read() {
    assert_eq!(exception_text(None, || None, || None), "Script threw an exception");
  }
}
