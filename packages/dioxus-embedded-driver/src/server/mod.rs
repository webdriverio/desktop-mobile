use std::net::SocketAddr;
use std::sync::Arc;

use tokio::runtime::Runtime as TokioRuntime;
use tokio::sync::RwLock;

pub mod handlers;
pub mod response;
pub mod router;

use crate::webdriver::SessionManager;

/// Shared state for the WebDriver HTTP server.
pub struct AppState {
  pub sessions: RwLock<SessionManager>,
}

impl AppState {
  pub fn new() -> Self {
    Self { sessions: RwLock::new(SessionManager::new()) }
  }

  /// Window labels currently registered with the bridge, in creation order.
  pub fn list_windows(&self) -> Vec<String> {
    wdio_dioxus_bridge::window_state::list_labels()
  }

  /// Block until at least one window is available (or timeout elapses).
  pub async fn wait_for_window(&self, timeout_ms: u64) -> Option<String> {
    let deadline = tokio::time::Instant::now()
      + std::time::Duration::from_millis(timeout_ms);
    loop {
      let labels = self.list_windows();
      if let Some(label) = labels.into_iter().next() {
        return Some(label);
      }
      if tokio::time::Instant::now() >= deadline {
        return None;
      }
      tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
  }
}

impl Default for AppState {
  fn default() -> Self {
    Self::new()
  }
}

/// Start the WebDriver HTTP server on a background Tokio runtime thread.
pub fn start(port: u16) {
  std::thread::spawn(move || {
    let rt = match TokioRuntime::new() {
      Ok(rt) => rt,
      Err(e) => {
        tracing::error!("failed to create tokio runtime for embedded driver: {e}");
        return;
      }
    };
    rt.block_on(async move {
      let state = Arc::new(AppState::new());
      let app = router::create_router(state);
      let addr = SocketAddr::from(([127, 0, 0, 1], port));
      let listener = match tokio::net::TcpListener::bind(addr).await {
        Ok(l) => l,
        Err(e) => {
          tracing::error!("embedded WebDriver server failed to bind {addr}: {e}");
          return;
        }
      };
      tracing::info!("embedded WebDriver server listening on http://{addr}");
      if let Err(e) = axum::serve(listener, app).await {
        tracing::error!("embedded WebDriver server error: {e}");
      }
    });
  });
}
