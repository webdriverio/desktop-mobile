// Copied verbatim from packages/tauri-plugin-webdriver/src/server/response.rs
// (no Tauri deps in this file).
use axum::{
  http::StatusCode,
  response::{IntoResponse, Response},
  Json,
};
use serde::Serialize;
use serde_json::{json, Value};

#[derive(Debug, Serialize)]
pub struct WebDriverResponse {
  pub value: Value,
}

impl WebDriverResponse {
  pub fn success<T: Serialize>(value: T) -> Self {
    Self { value: serde_json::to_value(value).unwrap_or(Value::Null) }
  }

  pub fn null() -> Self {
    Self { value: Value::Null }
  }
}

impl IntoResponse for WebDriverResponse {
  fn into_response(self) -> Response {
    (
      StatusCode::OK,
      [("Content-Type", "application/json; charset=utf-8")],
      Json(self),
    )
      .into_response()
  }
}

#[derive(Debug)]
pub struct WebDriverErrorResponse {
  pub status: StatusCode,
  pub error: String,
  pub message: String,
  pub stacktrace: Option<String>,
}

impl WebDriverErrorResponse {
  pub fn new(status: StatusCode, error: &str, message: &str, stacktrace: Option<String>) -> Self {
    Self {
      status,
      error: error.to_string(),
      message: message.to_string(),
      stacktrace,
    }
  }

  pub fn invalid_session_id(id: &str) -> Self {
    Self::new(StatusCode::NOT_FOUND, "invalid session id", &format!("Session {id} not found"), None)
  }

  pub fn no_such_element() -> Self {
    Self::new(StatusCode::NOT_FOUND, "no such element", "Unable to locate element", None)
  }

  pub fn no_such_window() -> Self {
    Self::new(StatusCode::NOT_FOUND, "no such window", "No window could be found", None)
  }

  pub fn javascript_error(message: &str, stacktrace: Option<String>) -> Self {
    Self::new(StatusCode::INTERNAL_SERVER_ERROR, "javascript error", message, stacktrace)
  }

  pub fn script_timeout() -> Self {
    Self::new(StatusCode::INTERNAL_SERVER_ERROR, "script timeout", "Script execution timed out", None)
  }

  pub fn unknown_error(message: &str) -> Self {
    Self::new(StatusCode::INTERNAL_SERVER_ERROR, "unknown error", message, None)
  }

  pub fn invalid_argument(message: &str) -> Self {
    Self::new(StatusCode::BAD_REQUEST, "invalid argument", message, None)
  }

  pub fn unsupported_operation(message: &str) -> Self {
    Self::new(StatusCode::INTERNAL_SERVER_ERROR, "unsupported operation", message, None)
  }

  pub fn stale_element_reference() -> Self {
    Self::new(StatusCode::NOT_FOUND, "stale element reference", "Element is no longer attached to the DOM", None)
  }

  pub fn no_such_cookie(name: &str) -> Self {
    Self::new(StatusCode::NOT_FOUND, "no such cookie", &format!("Cookie '{name}' not found"), None)
  }
}

impl IntoResponse for WebDriverErrorResponse {
  fn into_response(self) -> Response {
    let body = json!({
      "value": {
        "error": self.error,
        "message": self.message,
        "stacktrace": self.stacktrace.unwrap_or_default()
      }
    });
    (
      self.status,
      [("Content-Type", "application/json; charset=utf-8")],
      Json(body),
    )
      .into_response()
  }
}

pub type WebDriverResult = Result<WebDriverResponse, WebDriverErrorResponse>;

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn should_serialize_success_response() {
    let r = WebDriverResponse::success(42u32);
    assert_eq!(r.value, serde_json::json!(42));
  }

  #[test]
  fn should_serialize_null_response() {
    let r = WebDriverResponse::null();
    assert_eq!(r.value, Value::Null);
  }

  #[test]
  fn should_build_invalid_session_error() {
    let e = WebDriverErrorResponse::invalid_session_id("abc");
    assert_eq!(e.error, "invalid session id");
    assert!(e.message.contains("abc"));
  }
}
