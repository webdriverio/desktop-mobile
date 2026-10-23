use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Path, State};
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use tauri::{Listener, Manager, Runtime};
use tokio::sync::Notify;

use crate::platform::{wait_until_applied, WindowRect};
use crate::server::response::{WebDriverErrorResponse, WebDriverResponse, WebDriverResult};
use crate::server::AppState;

/// How long Close Window waits for the window to be destroyed before taking the close as prevented.
const CLOSE_WINDOW_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Debug, Deserialize)]
pub struct SwitchWindowRequest {
    pub handle: String,
}

#[derive(Debug, Deserialize)]
pub struct NewWindowRequest {
    #[allow(dead_code)] // Part of W3C protocol but not used in current implementation
    #[serde(rename = "type", default)]
    pub window_type: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct WindowRectRequest {
    #[serde(default)]
    pub x: Option<i32>,
    #[serde(default)]
    pub y: Option<i32>,
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
}

/// GET `/session/{session_id}/window` - Get current window handle
pub async fn get_window_handle<R: Runtime>(
    State(state): State<Arc<AppState<R>>>,
    Path(session_id): Path<String>,
) -> WebDriverResult {
    let sessions = state.sessions.read().await;
    let session = sessions.get(&session_id)?;
    let current_window = session.current_window.clone();
    drop(sessions);

    // Return the session's current window handle
    Ok(WebDriverResponse::success(current_window))
}

/// GET `/session/{session_id}/window/handles` - Get all window handles
pub async fn get_window_handles<R: Runtime>(
    State(state): State<Arc<AppState<R>>>,
    Path(session_id): Path<String>,
) -> WebDriverResult {
    let sessions = state.sessions.read().await;
    let _session = sessions.get(&session_id)?;
    drop(sessions);

    // Return all window labels as handles
    let handles: Vec<String> = state.app.webview_windows().keys().cloned().collect();

    Ok(WebDriverResponse::success(handles))
}

/// DELETE `/session/{session_id}/window` - Close current window
pub async fn close_window<R: Runtime>(
    State(state): State<Arc<AppState<R>>>,
    Path(session_id): Path<String>,
) -> WebDriverResult {
    let sessions = state.sessions.read().await;
    let session = sessions.get(&session_id)?;
    let current_window = session.current_window.clone();
    drop(sessions);

    let Some(window) = state.app.webview_windows().get(&current_window).cloned() else {
        return Err(WebDriverErrorResponse::no_such_window());
    };

    let destroyed = Arc::new(AtomicBool::new(false));
    let notify = Arc::new(Notify::new());
    let listener_id = window.listen("tauri://destroyed", {
        let destroyed = Arc::clone(&destroyed);
        let notify = Arc::clone(&notify);
        move |_| {
            destroyed.store(true, Ordering::SeqCst);
            notify.notify_one();
        }
    });

    // Unlike destroy(), close() runs the app's CloseRequested handlers, which can prevent it.
    let close_result = window.close();
    let closed = close_result.is_ok()
        && wait_until_applied(&notify, CLOSE_WINDOW_TIMEOUT, || {
            destroyed.load(Ordering::SeqCst)
        })
        .await;
    window.unlisten(listener_id);
    close_result.map_err(|e| WebDriverErrorResponse::unknown_error(&e.to_string()))?;

    let labels = state.app.webview_windows().into_keys();
    Ok(WebDriverResponse::success(remaining_handles(
        labels,
        &current_window,
        closed,
    )))
}

/// A destroyed window can stay listed for a moment, so it's dropped from the handles here.
fn remaining_handles(
    labels: impl IntoIterator<Item = String>,
    closing_label: &str,
    closed: bool,
) -> Vec<String> {
    labels
        .into_iter()
        .filter(|label| !closed || label != closing_label)
        .collect()
}

/// POST `/session/{session_id}/window` - Switch to window
pub async fn switch_to_window<R: Runtime>(
    State(state): State<Arc<AppState<R>>>,
    Path(session_id): Path<String>,
    Json(request): Json<SwitchWindowRequest>,
) -> WebDriverResult {
    let mut sessions = state.sessions.write().await;
    let session = sessions.get_mut(&session_id)?;

    // Verify the window exists
    if !state.app.webview_windows().contains_key(&request.handle) {
        return Err(WebDriverErrorResponse::no_such_window());
    }

    session.switch_to_window(request.handle).map_err(|_| {
        WebDriverErrorResponse::unknown_error("Browsing context generation overflowed")
    })?;

    Ok(WebDriverResponse::null())
}

/// POST `/session/{session_id}/window/new` - Create new window
pub async fn new_window<R: Runtime + 'static>(
    State(state): State<Arc<AppState<R>>>,
    Path(session_id): Path<String>,
    Json(_request): Json<NewWindowRequest>,
) -> WebDriverResult {
    let sessions = state.sessions.read().await;
    let _session = sessions.get(&session_id)?;
    drop(sessions);

    // Note: Creating new windows in Tauri requires app-specific logic
    // This is a stub that returns an error - apps should handle this via commands
    Err(WebDriverErrorResponse::unsupported_operation(
        "Creating new windows is not supported in this context",
    ))
}

/// GET `/session/{session_id}/window/rect` - Get window rect
pub async fn get_rect<R: Runtime + 'static>(
    State(state): State<Arc<AppState<R>>>,
    Path(session_id): Path<String>,
) -> WebDriverResult {
    let sessions = state.sessions.read().await;
    let session = sessions.get(&session_id)?;
    let current_window = session.current_window.clone();
    let timeouts = session.timeouts.clone();
    let frame_context = session.frame_context.clone();
    drop(sessions);

    let executor = state.get_executor_for_window(&current_window, timeouts, frame_context)?;
    let rect = executor.get_window_rect().await?;

    Ok(WebDriverResponse::success(json!({
        "x": rect.x,
        "y": rect.y,
        "width": rect.width,
        "height": rect.height
    })))
}

/// POST `/session/{session_id}/window/rect` - Set window rect
pub async fn set_rect<R: Runtime + 'static>(
    State(state): State<Arc<AppState<R>>>,
    Path(session_id): Path<String>,
    Json(request): Json<WindowRectRequest>,
) -> WebDriverResult {
    let sessions = state.sessions.read().await;
    let session = sessions.get(&session_id)?;
    let current_window = session.current_window.clone();
    let timeouts = session.timeouts.clone();
    let frame_context = session.frame_context.clone();
    drop(sessions);

    let executor = state.get_executor_for_window(&current_window, timeouts, frame_context)?;

    // Get current rect to fill in missing values
    let current = executor.get_window_rect().await?;

    let new_rect = WindowRect {
        x: request.x.unwrap_or(current.x),
        y: request.y.unwrap_or(current.y),
        width: request.width.unwrap_or(current.width),
        height: request.height.unwrap_or(current.height),
    };

    let rect = executor.set_window_rect(new_rect).await?;

    Ok(WebDriverResponse::success(json!({
        "x": rect.x,
        "y": rect.y,
        "width": rect.width,
        "height": rect.height
    })))
}

/// POST `/session/{session_id}/window/maximize` - Maximize window
pub async fn maximize<R: Runtime + 'static>(
    State(state): State<Arc<AppState<R>>>,
    Path(session_id): Path<String>,
) -> WebDriverResult {
    let sessions = state.sessions.read().await;
    let session = sessions.get(&session_id)?;
    let current_window = session.current_window.clone();
    let timeouts = session.timeouts.clone();
    let frame_context = session.frame_context.clone();
    drop(sessions);

    let executor = state.get_executor_for_window(&current_window, timeouts, frame_context)?;
    let rect = executor.maximize_window().await?;

    Ok(WebDriverResponse::success(json!({
        "x": rect.x,
        "y": rect.y,
        "width": rect.width,
        "height": rect.height
    })))
}

/// POST `/session/{session_id}/window/minimize` - Minimize window
pub async fn minimize<R: Runtime + 'static>(
    State(state): State<Arc<AppState<R>>>,
    Path(session_id): Path<String>,
) -> WebDriverResult {
    let sessions = state.sessions.read().await;
    let session = sessions.get(&session_id)?;
    let current_window = session.current_window.clone();
    let timeouts = session.timeouts.clone();
    let frame_context = session.frame_context.clone();
    drop(sessions);

    let executor = state.get_executor_for_window(&current_window, timeouts, frame_context)?;
    executor.minimize_window().await?;

    // Return null per W3C spec (minimized window has no meaningful rect)
    Ok(WebDriverResponse::null())
}

/// POST `/session/{session_id}/window/fullscreen` - Fullscreen window
pub async fn fullscreen<R: Runtime + 'static>(
    State(state): State<Arc<AppState<R>>>,
    Path(session_id): Path<String>,
) -> WebDriverResult {
    let sessions = state.sessions.read().await;
    let session = sessions.get(&session_id)?;
    let current_window = session.current_window.clone();
    let timeouts = session.timeouts.clone();
    let frame_context = session.frame_context.clone();
    drop(sessions);

    let executor = state.get_executor_for_window(&current_window, timeouts, frame_context)?;
    let rect = executor.fullscreen_window().await?;

    Ok(WebDriverResponse::success(json!({
        "x": rect.x,
        "y": rect.y,
        "width": rect.width,
        "height": rect.height
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn labels(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| (*name).to_string()).collect()
    }

    #[test]
    fn a_closed_window_is_left_out_even_while_still_listed() {
        let handles = remaining_handles(labels(&["main", "settings"]), "settings", true);
        assert_eq!(handles, labels(&["main"]));
    }

    #[test]
    fn a_prevented_close_keeps_the_window() {
        let handles = remaining_handles(labels(&["main", "settings"]), "settings", false);
        assert_eq!(handles, labels(&["main", "settings"]));
    }

    #[test]
    fn closing_the_last_window_leaves_no_handles() {
        assert!(remaining_handles(labels(&["main"]), "main", true).is_empty());
    }
}
