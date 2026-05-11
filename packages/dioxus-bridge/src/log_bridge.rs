//! Frontend → backend log bridge.
//!
//! Registers a `log_frontend` command on the [`crate::invoke::CommandRegistry`].
//! The guest-js console wrapper intercepts `console.log/info/warn/error/debug`
//! calls and forwards each line through `dx.invoke('log_frontend', { level,
//! message })`. The Rust handler emits the line to stdout with a
//! `[WDIO-FRONTEND][<LEVEL>]` marker so the launcher's log capture can
//! distinguish frontend lines from backend (Rust-side) tracing output.
//!
//! Backend logs flow through the standard `tracing` infrastructure — the
//! launcher captures the Dioxus app's stdout/stderr via
//! `@wdio/native-core`'s stream-based capture and routes each line through
//! @wdio/dioxus-service's parseLogLine.

use serde::Deserialize;
use serde_json::{json, Value};

use crate::invoke::CommandRegistry;

/// Marker emitted on every line forwarded from the frontend. The TS-side
/// parser splits on this token to classify lines as frontend logs.
pub const FRONTEND_MARKER: &str = "[WDIO-FRONTEND]";

#[derive(Debug, Deserialize)]
struct LogFrontendArgs {
  #[serde(default)]
  level: String,
  #[serde(default)]
  message: String,
}

/// Register `log_frontend` on the supplied [`CommandRegistry`].
///
/// The handler receives `{ level: String, message: String }` and prints a
/// marked line to stdout. Returns the same registry for chainability.
pub fn register(registry: &CommandRegistry) -> &CommandRegistry {
  registry.register("log_frontend", |args: Value| {
    let parsed: LogFrontendArgs = serde_json::from_value(args).map_err(|e| format!("invalid log_frontend args: {e}"))?;
    let level = if parsed.level.is_empty() {
      "INFO".to_string()
    } else {
      parsed.level.to_uppercase()
    };
    println!("{FRONTEND_MARKER}[{level}] {}", parsed.message);
    Ok(json!(null))
  });
  registry
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::invoke::{handle_invoke_request, CommandRegistry};
  use dioxus_desktop::wry::http::Request;

  fn req(body: &str) -> Request<Vec<u8>> {
    Request::builder()
      .method("POST")
      .uri("wdio://invoke")
      .body(body.as_bytes().to_vec())
      .unwrap()
  }

  fn response_body(response: &dioxus_desktop::wry::http::Response<std::borrow::Cow<'static, [u8]>>) -> Value {
    serde_json::from_slice(response.body()).unwrap()
  }

  #[test]
  fn should_register_log_frontend_command() {
    let registry = CommandRegistry::new();
    register(&registry);
    let response = handle_invoke_request(
      &registry,
      &req(r#"{"command":"log_frontend","args":{"level":"info","message":"hello"}}"#),
    );
    let body = response_body(&response);
    assert_eq!(body["ok"], true);
  }

  #[test]
  fn should_default_level_to_info_when_omitted() {
    let registry = CommandRegistry::new();
    register(&registry);
    let response = handle_invoke_request(
      &registry,
      &req(r#"{"command":"log_frontend","args":{"message":"plain"}}"#),
    );
    let body = response_body(&response);
    assert_eq!(body["ok"], true);
  }

  #[test]
  fn should_reject_malformed_args() {
    let registry = CommandRegistry::new();
    register(&registry);
    let response = handle_invoke_request(
      &registry,
      &req(r#"{"command":"log_frontend","args":"not-an-object"}"#),
    );
    let body = response_body(&response);
    assert_eq!(body["ok"], false);
    assert!(body["error"].as_str().unwrap().contains("invalid log_frontend args"));
  }
}
