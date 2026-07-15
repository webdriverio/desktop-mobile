use std::sync::Arc;

use axum::extract::{Path, State};
use axum::Json;
use serde::Deserialize;
use serde_json::json;
use tauri::Runtime;

#[cfg(desktop)]
use crate::platform::is_standalone_webview;
use crate::platform::WindowRect;
use crate::server::response::{WebDriverErrorResponse, WebDriverResponse, WebDriverResult};
use crate::server::AppState;

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

    if !state.has_window_label(&current_window) {
        return Err(WebDriverErrorResponse::no_such_window());
    }

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
    let handles = state.get_window_labels();

    Ok(WebDriverResponse::success(handles))
}

/// DELETE `/session/{session_id}/window` - Close current window
pub async fn close_window<R: Runtime>(
    State(state): State<Arc<AppState<R>>>,
    Path(session_id): Path<String>,
) -> WebDriverResult {
    // Window closing is not supported on mobile platforms
    #[cfg(mobile)]
    {
        let _ = (state, session_id);
        Err(WebDriverErrorResponse::unsupported_operation(
            "Closing windows is not supported on mobile platforms",
        ))
    }

    #[cfg(desktop)]
    {
        let sessions = state.sessions.read().await;
        let session = sessions.get(&session_id)?;
        let current_window = session.current_window.clone();
        drop(sessions);

        let webview = state
            .get_webview(&current_window)
            .ok_or_else(WebDriverErrorResponse::no_such_window)?;

        if !is_standalone_webview(&webview) {
            return Err(WebDriverErrorResponse::unsupported_operation(
                "Closing a child or shared-host webview is not supported",
            ));
        }

        webview
            .window()
            .destroy()
            .map_err(|error| WebDriverErrorResponse::unknown_error(&error.to_string()))?;

        let handles = state
            .get_window_labels()
            .into_iter()
            .filter(|label| label != &current_window)
            .collect::<Vec<_>>();

        Ok(WebDriverResponse::success(handles))
    }
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
    if !state.has_window_label(&request.handle) {
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
