use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Path, State};

use crate::server::response::{WebDriverResponse, WebDriverResult};
use crate::server::AppState;

/// Element screenshots fail rather than return a blank image until #741 captures them natively.
pub(crate) const UNSUPPORTED: &str = "element screenshots are not supported by the Dioxus \
  embedded driver yet (https://github.com/webdriverio/desktop-mobile/issues/741); on Windows and \
  Linux, the external driver provider supports them";

/// GET `/session/{session_id}/screenshot`
///
/// Captures the current window's visible page natively on the main thread
/// (WKWebView snapshot on macOS, WebView2 `CapturePreview` on Windows).
pub async fn take(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
) -> WebDriverResult {
  let (label, timeout_ms) = {
    let sessions = state.sessions.read().await;
    let session = sessions.get(&session_id)?;
    (session.current_window.clone(), session.timeouts.script_ms)
  };

  let png_base64 = crate::native::screenshot(&label, Duration::from_millis(timeout_ms)).await?;
  Ok(WebDriverResponse::success(png_base64))
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::server::handlers::element;

  #[test]
  fn element_screenshots_fail_as_unsupported() {
    tokio::runtime::Runtime::new().unwrap().block_on(async {
      let state = Arc::new(AppState::new());
      let id = state.sessions.write().await.create("main".into()).id.clone();

      let el =
        element::take_screenshot(State(state.clone()), Path((id, "el".into()))).await.unwrap_err();
      assert_eq!((el.error.as_str(), el.message.as_str()), ("unsupported operation", UNSUPPORTED));

      let missing = take(State(state), Path("missing".into())).await.unwrap_err();
      assert_eq!(missing.error, "invalid session id");
    });
  }

  #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
  #[test]
  fn page_screenshot_of_an_unattached_window_is_no_such_window() {
    tokio::runtime::Runtime::new().unwrap().block_on(async {
      let state = Arc::new(AppState::new());
      let id = state.sessions.write().await.create("main".into()).id.clone();

      let page = take(State(state), Path(id)).await.unwrap_err();
      assert_eq!(page.error, "no such window");
    });
  }
}
