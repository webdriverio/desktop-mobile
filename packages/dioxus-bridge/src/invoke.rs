//! `wdio://invoke` custom-protocol command bus.
//!
//! The bridge registers a `wdio://` URI handler via [`dioxus_desktop::Config::with_custom_protocol`].
//! Each request is a POST whose body is JSON of shape `{"command": String, "args": Json}`;
//! the response is `{"ok": true, "value": Json}` on success or
//! `{"ok": false, "error": String}` on failure.
//!
//! Commands are registered through [`CommandRegistry`] — one shared registry per
//! installed bridge, populated at startup. A built-in `__ping` command returns
//! `{"value": "pong"}` so `@wdio/dioxus-service` can sanity-check that the IPC
//! channel is alive before relying on it.
//!
//! Future bridge milestones will add: `__windowState` (for multi-window
//! support), `__listWindows`, `__execEval` (the `dx` field on
//! `window.__WDIO_DIOXUS__`), and mock-related plumbing for the
//! `@wdio/native-spy` DioxusAdapter.

use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use dioxus_desktop::wry::http::{HeaderMap, HeaderValue, Method, Request, Response, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// A registered command handler. Receives the JSON args from the wire and
/// returns either a JSON value to send back, or an error string.
pub type CommandHandler = Arc<dyn Fn(Value) -> Result<Value, String> + Send + Sync + 'static>;

/// Per-bridge command registry. Created in [`crate::install`] and populated
/// with the built-in commands; callers can register additional commands via
/// [`CommandRegistry::register`] before `install()` runs.
#[derive(Clone, Default)]
pub struct CommandRegistry {
  handlers: Arc<RwLock<HashMap<String, CommandHandler>>>,
}

impl CommandRegistry {
  pub fn new() -> Self {
    let registry = Self::default();
    registry.register_builtins();
    registry
  }

  fn register_builtins(&self) {
    // __ping — returns "pong" so the service can verify the IPC channel works.
    self.register("__ping", |_args| Ok(json!("pong")));
  }

  /// Register a command handler. Replaces any existing handler with the same name.
  pub fn register<F>(&self, command: impl Into<String>, handler: F)
  where
    F: Fn(Value) -> Result<Value, String> + Send + Sync + 'static,
  {
    self
      .handlers
      .write()
      .expect("CommandRegistry lock poisoned")
      .insert(command.into(), Arc::new(handler));
  }

  /// Look up and call a handler. Returns the response body that should be
  /// written into the HTTP response.
  pub fn dispatch(&self, command: &str, args: Value) -> InvokeResponseBody {
    let handler = {
      let map = self.handlers.read().expect("CommandRegistry lock poisoned");
      map.get(command).cloned()
    };

    match handler {
      Some(h) => match h(args) {
        Ok(value) => InvokeResponseBody::Ok { ok: true, value },
        Err(error) => InvokeResponseBody::Err { ok: false, error },
      },
      None => InvokeResponseBody::Err {
        ok: false,
        error: format!("unknown wdio:// command: {command}"),
      },
    }
  }
}

#[derive(Deserialize)]
struct InvokeRequestBody {
  command: String,
  #[serde(default)]
  args: Value,
}

#[derive(Serialize)]
#[serde(untagged)]
pub enum InvokeResponseBody {
  Ok { ok: bool, value: Value },
  Err { ok: bool, error: String },
}

impl InvokeResponseBody {
  fn malformed(reason: impl Into<String>) -> Self {
    Self::Err {
      ok: false,
      error: reason.into(),
    }
  }
}

fn cors_headers(headers: &mut HeaderMap) {
  headers.insert("access-control-allow-origin", HeaderValue::from_static("*"));
  headers.insert("access-control-allow-methods", HeaderValue::from_static("POST, OPTIONS"));
  headers.insert("access-control-allow-headers", HeaderValue::from_static("content-type"));
}

/// Handle a single `wdio://` request. Pure function — easy to unit-test.
pub fn handle_invoke_request(
  registry: &CommandRegistry,
  request: &Request<Vec<u8>>,
) -> Response<Cow<'static, [u8]>> {
  // TEMPORARY DIAGNOSTIC — Windows WebView2 custom-protocol POST body investigation.
  // Logs method + URI + body length + first 80 chars of body so we can confirm
  // whether the body survives the WebView2 -> Rust handoff on Windows.
  let body_bytes = request.body();
  let body_preview: String = body_bytes.iter().take(80).map(|b| *b as char).collect();
  tracing::info!(
    target: "wdio_dioxus_bridge::diag",
    method = %request.method(),
    uri = %request.uri(),
    body_len = body_bytes.len(),
    body_preview = %body_preview,
    "wdio:// request received"
  );

  // CORS preflight — WKWebView and WebView2 enforce cross-origin policy even
  // for custom schemes. The guest-js bundle fetches wdio://invoke from the
  // dioxus://localhost/ origin (different scheme = different origin), so both
  // the preflight OPTIONS and the actual POST need CORS headers.
  if request.method() == Method::OPTIONS {
    let mut response = Response::new(Cow::Borrowed(b"" as &'static [u8]));
    *response.status_mut() = StatusCode::OK;
    cors_headers(response.headers_mut());
    return response;
  }

  let parsed: Result<InvokeRequestBody, _> = serde_json::from_slice(request.body());
  match &parsed {
    Ok(req) => tracing::info!(
      target: "wdio_dioxus_bridge::diag",
      command = %req.command,
      "wdio:// request parsed"
    ),
    Err(err) => tracing::warn!(
      target: "wdio_dioxus_bridge::diag",
      error = %err,
      "wdio:// request parse FAILED"
    ),
  }
  let body = match parsed {
    Ok(req) => registry.dispatch(&req.command, req.args),
    Err(err) => InvokeResponseBody::malformed(format!("invalid JSON request: {err}")),
  };

  let bytes = serde_json::to_vec(&body).unwrap_or_else(|_| {
    br#"{"ok":false,"error":"failed to serialise response"}"#.to_vec()
  });

  let mut response = Response::new(Cow::Owned(bytes));
  *response.status_mut() = StatusCode::OK;
  response.headers_mut().insert("content-type", HeaderValue::from_static("application/json"));
  cors_headers(response.headers_mut());
  response
}

#[cfg(test)]
mod tests {
  use super::*;

  fn req(body: &str) -> Request<Vec<u8>> {
    Request::builder()
      .method("POST")
      .uri("wdio://invoke")
      .body(body.as_bytes().to_vec())
      .unwrap()
  }

  fn parse_body(response: &Response<Cow<'static, [u8]>>) -> Value {
    serde_json::from_slice(response.body()).unwrap()
  }

  #[test]
  fn should_round_trip_the_builtin_ping_command() {
    let registry = CommandRegistry::new();
    let response = handle_invoke_request(&registry, &req(r#"{"command":"__ping"}"#));
    let body = parse_body(&response);
    assert_eq!(body["ok"], true);
    assert_eq!(body["value"], "pong");
  }

  #[test]
  fn should_return_error_for_unknown_command() {
    let registry = CommandRegistry::new();
    let response = handle_invoke_request(&registry, &req(r#"{"command":"nope"}"#));
    let body = parse_body(&response);
    assert_eq!(body["ok"], false);
    assert!(body["error"].as_str().unwrap().contains("unknown wdio:// command: nope"));
  }

  #[test]
  fn should_return_error_for_malformed_json() {
    let registry = CommandRegistry::new();
    let response = handle_invoke_request(&registry, &req("not-json"));
    let body = parse_body(&response);
    assert_eq!(body["ok"], false);
    assert!(body["error"].as_str().unwrap().contains("invalid JSON request"));
  }

  #[test]
  fn should_forward_args_to_registered_handlers() {
    let registry = CommandRegistry::new();
    registry.register("echo", |args| Ok(args));
    let response = handle_invoke_request(&registry, &req(r#"{"command":"echo","args":{"hello":"world"}}"#));
    let body = parse_body(&response);
    assert_eq!(body["ok"], true);
    assert_eq!(body["value"]["hello"], "world");
  }

  #[test]
  fn should_propagate_handler_errors() {
    let registry = CommandRegistry::new();
    registry.register("boom", |_args| Err("kaboom".to_string()));
    let response = handle_invoke_request(&registry, &req(r#"{"command":"boom"}"#));
    let body = parse_body(&response);
    assert_eq!(body["ok"], false);
    assert_eq!(body["error"], "kaboom");
  }

  #[test]
  fn should_default_args_to_null_when_omitted() {
    let mut received = None;
    let registry = CommandRegistry::new();
    let received_clone = Arc::new(std::sync::Mutex::new(received.take()));
    let received_clone_2 = received_clone.clone();
    registry.register("captureargs", move |args| {
      *received_clone_2.lock().unwrap() = Some(args.clone());
      Ok(Value::Null)
    });
    let _ = handle_invoke_request(&registry, &req(r#"{"command":"captureargs"}"#));
    received = received_clone.lock().unwrap().clone();
    assert_eq!(received.unwrap(), Value::Null);
  }

  #[test]
  fn should_allow_replacing_a_handler() {
    let registry = CommandRegistry::new();
    registry.register("greet", |_| Ok(json!("hi")));
    registry.register("greet", |_| Ok(json!("hello again")));
    let response = handle_invoke_request(&registry, &req(r#"{"command":"greet"}"#));
    let body = parse_body(&response);
    assert_eq!(body["value"], "hello again");
  }

  #[test]
  fn should_include_cors_origin_header_on_post_responses() {
    let registry = CommandRegistry::new();
    let response = handle_invoke_request(&registry, &req(r#"{"command":"__ping"}"#));
    assert_eq!(
      response.headers().get("access-control-allow-origin").map(|v| v.to_str().unwrap()),
      Some("*"),
    );
  }

  #[test]
  fn should_respond_to_options_preflight_with_cors_headers() {
    let registry = CommandRegistry::new();
    let options_req = Request::builder()
      .method("OPTIONS")
      .uri("wdio://invoke")
      .body(vec![])
      .unwrap();
    let response = handle_invoke_request(&registry, &options_req);
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
      response.headers().get("access-control-allow-origin").map(|v| v.to_str().unwrap()),
      Some("*"),
    );
    assert!(response.body().is_empty());
  }
}
