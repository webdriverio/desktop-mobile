use std::sync::Arc;

use axum::extract::{Path, State};

use crate::server::response::{WebDriverErrorResponse, WebDriverResult};
use crate::server::AppState;

/// Until #741 captures the webview natively, screenshots fail rather than return a blank image.
pub(crate) const UNSUPPORTED: &str = "screenshots are not supported by the Dioxus embedded driver \
  yet (https://github.com/webdriverio/desktop-mobile/issues/741); on Windows and Linux, the \
  external driver provider supports them";

/// GET `/session/{session_id}/screenshot`
pub async fn take(
  State(state): State<Arc<AppState>>,
  Path(session_id): Path<String>,
) -> WebDriverResult {
  state.sessions.read().await.get(&session_id)?;
  Err(WebDriverErrorResponse::unsupported_operation(UNSUPPORTED))
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::server::handlers::element;

  #[test]
  fn page_and_element_screenshots_fail_as_unsupported() {
    tokio::runtime::Runtime::new().unwrap().block_on(async {
      let state = Arc::new(AppState::new());
      let id = state.sessions.write().await.create("main".into()).id.clone();

      let page = take(State(state.clone()), Path(id.clone())).await.unwrap_err();
      assert_eq!(
        (page.error.as_str(), page.message.as_str()),
        ("unsupported operation", UNSUPPORTED)
      );
      let el =
        element::take_screenshot(State(state.clone()), Path((id, "el".into()))).await.unwrap_err();
      assert_eq!((el.error.as_str(), el.message.as_str()), ("unsupported operation", UNSUPPORTED));

      let missing = take(State(state), Path("missing".into())).await.unwrap_err();
      assert_eq!(missing.error, "invalid session id");
    });
  }
}
