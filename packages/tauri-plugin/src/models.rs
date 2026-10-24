pub use serde_json::Value as JsonValue;

/// Execute command request
#[derive(serde::Deserialize, Debug)]
pub struct ExecuteRequest {
  /// JavaScript code to execute
  pub script: String,
  /// Arguments to pass to the script
  #[serde(default)]
  pub args: Vec<JsonValue>,
  /// Window label to execute in (optional, uses current window if not specified)
  #[serde(default)]
  pub window_label: Option<String>,
}

/// Mock configuration
#[derive(serde::Deserialize, serde::Serialize, Debug, Clone)]
pub struct MockConfig {
  /// Command name to mock
  pub command: String,
  /// Mock return value (for mockReturnValue)
  pub return_value: Option<JsonValue>,
  /// Mock implementation (for mockImplementation - serialized function string)
  pub implementation: Option<String>,
}
