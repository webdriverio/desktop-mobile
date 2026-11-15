use axum::{
  extract::{Request, State},
  http::{header, HeaderMap, StatusCode},
  middleware::{self, Next},
  response::{IntoResponse, Response},
  Router,
};

use super::response::WebDriverErrorResponse;

/// Refuses requests a web page could make: a `Host` other than loopback on this port, as DNS
/// rebinding sends, and any `Origin` header, which browsers send and WebDriver clients don't.
pub fn layer(router: Router, port: u16) -> Router {
  router.layer(middleware::from_fn_with_state(port, check))
}

async fn check(State(port): State<u16>, request: Request, next: Next) -> Response {
  match refusal(request.headers(), port) {
    Some(message) => {
      tracing::warn!("refused a WebDriver request: {message}");
      WebDriverErrorResponse::new(StatusCode::FORBIDDEN, "unknown error", &message, None)
        .into_response()
    }
    None => next.run(request).await,
  }
}

fn refusal(headers: &HeaderMap, port: u16) -> Option<String> {
  if let Some(origin) = headers.get(header::ORIGIN) {
    return Some(format!("requests from a browser are not accepted (Origin: {origin:?})"));
  }
  let Some(host) = headers.get(header::HOST) else {
    return Some("a Host header is required".to_string());
  };
  let allowed = host.to_str().is_ok_and(|host| {
    let host = host.to_ascii_lowercase();
    ["127.0.0.1", "localhost", "[::1]"].iter().any(|name| host == format!("{name}:{port}"))
  });
  if allowed {
    None
  } else {
    Some(format!("Host {host:?} is not accepted; connect to 127.0.0.1:{port} or localhost:{port}"))
  }
}

#[cfg(test)]
mod tests {
  use axum::{body::Body, routing::get};
  use tower::ServiceExt;

  use super::*;

  const PORT: u16 = 4445;

  fn send(headers: &[(&str, &str)]) -> Response {
    let router = layer(Router::new().route("/status", get(|| async { "ok" })), PORT);
    let mut request = Request::builder().uri("/status");
    for (name, value) in headers {
      request = request.header(*name, *value);
    }
    let request = request.body(Body::empty()).unwrap();
    let runtime = tokio::runtime::Builder::new_current_thread().build().unwrap();
    runtime.block_on(router.oneshot(request)).unwrap()
  }

  #[test]
  fn accepts_loopback_hosts_on_its_port() {
    for host in ["127.0.0.1:4445", "localhost:4445", "LocalHost:4445", "[::1]:4445"] {
      assert_eq!(send(&[("host", host)]).status(), StatusCode::OK, "{host}");
    }
  }

  #[test]
  fn refuses_other_hosts() {
    for host in ["evil.example:4445", "127.0.0.1:4446", "localhost", "127.0.0.1.evil.example:4445"]
    {
      assert_eq!(send(&[("host", host)]).status(), StatusCode::FORBIDDEN, "{host}");
    }
  }

  #[test]
  fn refuses_a_missing_host() {
    assert_eq!(send(&[]).status(), StatusCode::FORBIDDEN);
  }

  #[test]
  fn refuses_an_origin_header() {
    for origin in ["http://127.0.0.1:4445", "null"] {
      let response = send(&[("host", "127.0.0.1:4445"), ("origin", origin)]);
      assert_eq!(response.status(), StatusCode::FORBIDDEN, "{origin}");
    }
  }

  #[test]
  fn refuses_with_a_webdriver_error() {
    let response = send(&[("host", "evil.example:4445")]);
    let runtime = tokio::runtime::Builder::new_current_thread().build().unwrap();
    let body = runtime.block_on(axum::body::to_bytes(response.into_body(), usize::MAX)).unwrap();
    let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(body["value"]["error"], "unknown error");
    assert!(body["value"]["message"].as_str().unwrap().contains("evil.example"));
  }
}
