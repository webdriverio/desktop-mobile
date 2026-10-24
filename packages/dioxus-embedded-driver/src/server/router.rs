use std::sync::Arc;

use axum::{
  routing::{delete, get, post},
  Router,
};

use super::handlers;
use super::AppState;

pub fn create_router(state: Arc<AppState>) -> Router {
  Router::new()
    .route("/status", get(handlers::status))
    // Session management
    .route("/session", post(handlers::session::create))
    .route("/session/{session_id}", delete(handlers::session::delete))
    // Timeouts
    .route(
      "/session/{session_id}/timeouts",
      get(handlers::timeouts::get).post(handlers::timeouts::set),
    )
    // Navigation
    .route(
      "/session/{session_id}/url",
      get(handlers::navigation::get_url).post(handlers::navigation::navigate),
    )
    .route("/session/{session_id}/title", get(handlers::navigation::get_title))
    .route("/session/{session_id}/back", post(handlers::navigation::back))
    .route("/session/{session_id}/forward", post(handlers::navigation::forward))
    .route("/session/{session_id}/refresh", post(handlers::navigation::refresh))
    // Execute Script
    .route("/session/{session_id}/execute/sync", post(handlers::script::execute_sync))
    .route("/session/{session_id}/execute/async", post(handlers::script::execute_async))
    // Screenshot
    .route("/session/{session_id}/screenshot", get(handlers::screenshot::take))
    // Document
    .route("/session/{session_id}/source", get(handlers::document::get_source))
    // Elements
    .route("/session/{session_id}/element", post(handlers::element::find))
    .route("/session/{session_id}/elements", post(handlers::element::find_all))
    .route("/session/{session_id}/element/active", get(handlers::element::get_active))
    .route(
      "/session/{session_id}/element/{element_id}/element",
      post(handlers::element::find_from_element),
    )
    .route(
      "/session/{session_id}/element/{element_id}/elements",
      post(handlers::element::find_all_from_element),
    )
    .route(
      "/session/{session_id}/element/{element_id}/click",
      post(handlers::element::click),
    )
    .route(
      "/session/{session_id}/element/{element_id}/clear",
      post(handlers::element::clear),
    )
    .route(
      "/session/{session_id}/element/{element_id}/value",
      post(handlers::element::send_keys),
    )
    .route(
      "/session/{session_id}/element/{element_id}/text",
      get(handlers::element::get_text),
    )
    .route(
      "/session/{session_id}/element/{element_id}/name",
      get(handlers::element::get_tag_name),
    )
    .route(
      "/session/{session_id}/element/{element_id}/attribute/{name}",
      get(handlers::element::get_attribute),
    )
    .route(
      "/session/{session_id}/element/{element_id}/property/{name}",
      get(handlers::element::get_property),
    )
    .route(
      "/session/{session_id}/element/{element_id}/css/{property_name}",
      get(handlers::element::get_css_value),
    )
    .route(
      "/session/{session_id}/element/{element_id}/rect",
      get(handlers::element::get_rect),
    )
    .route(
      "/session/{session_id}/element/{element_id}/selected",
      get(handlers::element::is_selected),
    )
    .route(
      "/session/{session_id}/element/{element_id}/displayed",
      get(handlers::element::is_displayed),
    )
    .route(
      "/session/{session_id}/element/{element_id}/enabled",
      get(handlers::element::is_enabled),
    )
    .route(
      "/session/{session_id}/element/{element_id}/screenshot",
      get(handlers::element::take_screenshot),
    )
    // Window management
    .route(
      "/session/{session_id}/window",
      get(handlers::window::get_window_handle)
        .post(handlers::window::switch_to_window)
        .delete(handlers::window::close_window),
    )
    .route("/session/{session_id}/window/handles", get(handlers::window::get_window_handles))
    .route(
      "/session/{session_id}/window/rect",
      get(handlers::window::get_rect).post(handlers::window::set_rect),
    )
    .route("/session/{session_id}/window/maximize", post(handlers::window::maximize))
    .route("/session/{session_id}/window/minimize", post(handlers::window::minimize))
    .route("/session/{session_id}/window/fullscreen", post(handlers::window::fullscreen))
    // Alerts (stub — Dioxus doesn't use browser alerts)
    .route("/session/{session_id}/alert/dismiss", post(handlers::stubs::not_implemented))
    .route("/session/{session_id}/alert/accept", post(handlers::stubs::not_implemented))
    .route(
      "/session/{session_id}/alert/text",
      get(handlers::stubs::not_implemented).post(handlers::stubs::not_implemented),
    )
    // Frames (stub)
    .route("/session/{session_id}/frame", post(handlers::stubs::not_implemented))
    .route("/session/{session_id}/frame/parent", post(handlers::stubs::not_implemented))
    // Cookies
    .route(
      "/session/{session_id}/cookie",
      get(handlers::cookie::get_all)
        .post(handlers::cookie::add)
        .delete(handlers::cookie::delete_all),
    )
    .route(
      "/session/{session_id}/cookie/{name}",
      get(handlers::cookie::get).delete(handlers::cookie::delete),
    )
    // Actions
    .route(
      "/session/{session_id}/actions",
      post(handlers::actions::perform).delete(handlers::actions::release),
    )
    // Print (stub)
    .route("/session/{session_id}/print", post(handlers::stubs::not_implemented))
    .with_state(state)
}
