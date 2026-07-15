use std::net::SocketAddr;
use std::sync::Arc;

use tauri::{AppHandle, Manager, Runtime};
use tokio::runtime::Runtime as TokioRuntime;
use tokio::sync::RwLock;

pub mod handlers;
pub mod response;
pub mod router;

use crate::platform::{create_executor, FrameId, PlatformExecutor};
use crate::server::response::WebDriverErrorResponse;
use crate::webdriver::{SessionManager, Timeouts};

/// Shared state for the `WebDriver` server
pub struct AppState<R: Runtime> {
    pub app: AppHandle<R>,
    pub sessions: RwLock<SessionManager>,
}

impl<R: Runtime + 'static> AppState<R> {
    pub fn new(app: AppHandle<R>) -> Self {
        Self {
            app,
            sessions: RwLock::new(SessionManager::new()),
        }
    }

    /// Get a platform executor for a specific window by label
    pub fn get_executor_for_window(
        &self,
        window_label: &str,
        timeouts: Timeouts,
        frame_context: Vec<FrameId>,
    ) -> Result<Arc<dyn PlatformExecutor<R>>, WebDriverErrorResponse> {
        self.get_webview(window_label)
            .map(|webview| create_executor(webview, timeouts, frame_context))
            .ok_or_else(WebDriverErrorResponse::no_such_window)
    }

    pub fn get_webview(&self, window_label: &str) -> Option<tauri::Webview<R>> {
        self.app
            .webviews()
            .get(window_label)
            .filter(|webview| {
                is_webview_exposed(
                    child_webviews_are_exposed(),
                    webview.label(),
                    webview.window().label(),
                )
            })
            .cloned()
    }

    pub fn has_window_label(&self, window_label: &str) -> bool {
        self.get_webview(window_label).is_some()
    }

    /// Get all window labels
    pub fn get_window_labels(&self) -> Vec<String> {
        self.app
            .webviews()
            .values()
            .filter(|webview| {
                is_webview_exposed(
                    child_webviews_are_exposed(),
                    webview.label(),
                    webview.window().label(),
                )
            })
            .map(|webview| webview.label().to_string())
            .collect()
    }
}

fn child_webviews_are_exposed() -> bool {
    cfg!(any(
        target_os = "macos",
        target_os = "android",
        target_os = "ios"
    ))
}

fn is_webview_exposed(expose_children: bool, webview_label: &str, window_label: &str) -> bool {
    expose_children || webview_label == window_label
}

/// Start the `WebDriver` HTTP server on the specified port
pub fn start<R: Runtime + 'static>(app: AppHandle<R>, port: u16) {
    std::thread::spawn(move || {
        let rt = match TokioRuntime::new() {
            Ok(rt) => rt,
            Err(e) => {
                tracing::error!("Failed to create Tokio runtime for WebDriver server: {}", e);
                return;
            }
        };

        rt.block_on(async {
            let state = Arc::new(AppState::new(app));
            let router = router::create_router(state);

            // On Android, bind to all interfaces for WiFi accessibility
            // On other platforms, bind to localhost only for security
            #[cfg(target_os = "android")]
            let addr = SocketAddr::from(([0, 0, 0, 0], port));
            #[cfg(not(target_os = "android"))]
            let addr = SocketAddr::from(([127, 0, 0, 1], port));

            let listener = match tokio::net::TcpListener::bind(addr).await {
                Ok(l) => l,
                Err(e) => {
                    tracing::error!(
                        "Failed to bind WebDriver server to {} — port may already be in use: {}",
                        addr,
                        e
                    );
                    return;
                }
            };

            tracing::info!("WebDriver server listening on http://{}", addr);

            if let Err(e) = axum::serve(listener, router).await {
                tracing::error!("WebDriver server error: {}", e);
            }
        });
    });
}

#[cfg(test)]
mod tests {
    use super::{child_webviews_are_exposed, is_webview_exposed};

    #[test]
    fn primary_only_policy_hides_child_webviews() {
        assert!(is_webview_exposed(false, "main", "main"));
        assert!(!is_webview_exposed(false, "child", "main"));
    }

    #[test]
    fn all_webviews_policy_keeps_child_webviews_visible() {
        assert!(is_webview_exposed(true, "main", "main"));
        assert!(is_webview_exposed(true, "child", "main"));
    }

    #[test]
    fn platform_policy_only_exposes_children_on_supported_platforms() {
        #[cfg(any(target_os = "macos", target_os = "android", target_os = "ios"))]
        assert!(child_webviews_are_exposed());

        #[cfg(any(target_os = "windows", target_os = "linux"))]
        assert!(!child_webviews_are_exposed());
    }
}
