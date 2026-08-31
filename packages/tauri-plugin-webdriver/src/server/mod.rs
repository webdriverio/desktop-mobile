use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, RwLock as SyncRwLock};

use tauri::{AppHandle, Manager, Runtime, WebviewWindow};
use tokio::runtime::Runtime as TokioRuntime;
use tokio::sync::RwLock;

pub mod handlers;
pub mod response;
pub mod router;

use crate::platform::{create_executor, FrameId, PlatformExecutor};
use crate::server::response::WebDriverErrorResponse;
use crate::webdriver::{SessionManager, Timeouts};

struct WindowCache<T> {
    windows: HashMap<String, T>,
}

impl<T: Clone> WindowCache<T> {
    fn new() -> Self {
        Self {
            windows: HashMap::new(),
        }
    }

    fn merge(&mut self, live_windows: impl IntoIterator<Item = (String, T)>) {
        self.windows.extend(live_windows);
    }

    fn get(&self, window_label: &str) -> Option<T> {
        self.windows.get(window_label).cloned()
    }

    fn remove(&mut self, window_label: &str) {
        self.windows.remove(window_label);
    }

    fn contains(&self, window_label: &str) -> bool {
        self.windows.contains_key(window_label)
    }

    fn labels(&self) -> Vec<String> {
        self.windows.keys().cloned().collect()
    }
}

/// Shared state for the `WebDriver` server
pub struct AppState<R: Runtime> {
    pub app: AppHandle<R>,
    pub sessions: RwLock<SessionManager>,
    // Tauri can stop enumerating a parent WebviewWindow after it gains child webviews.
    windows: SyncRwLock<WindowCache<WebviewWindow<R>>>,
}

impl<R: Runtime + 'static> AppState<R> {
    pub fn new(app: AppHandle<R>) -> Self {
        let state = Self {
            app,
            sessions: RwLock::new(SessionManager::new()),
            windows: SyncRwLock::new(WindowCache::new()),
        };
        state.refresh_windows();
        state
    }

    fn refresh_windows(&self) {
        self.windows
            .write()
            .expect("AppState window cache poisoned")
            .merge(self.app.webview_windows());
    }

    fn get_window(&self, window_label: &str) -> Option<WebviewWindow<R>> {
        self.refresh_windows();
        self.windows
            .read()
            .expect("AppState window cache poisoned")
            .get(window_label)
    }

    pub fn remove_window_label(&self, window_label: &str) {
        self.windows
            .write()
            .expect("AppState window cache poisoned")
            .remove(window_label);
    }

    /// Get a platform executor for a specific window by label
    pub fn get_executor_for_window(
        &self,
        window_label: &str,
        timeouts: Timeouts,
        frame_context: Vec<FrameId>,
    ) -> Result<Arc<dyn PlatformExecutor<R>>, WebDriverErrorResponse> {
        self.get_window(window_label)
            .map(|window| create_executor(window, timeouts, frame_context))
            .ok_or_else(WebDriverErrorResponse::no_such_window)
    }

    /// Whether a window with this label has been registered
    pub fn has_window_label(&self, window_label: &str) -> bool {
        self.refresh_windows();
        self.windows
            .read()
            .expect("AppState window cache poisoned")
            .contains(window_label)
    }

    /// Get all window labels
    pub fn get_window_labels(&self) -> Vec<String> {
        self.refresh_windows();
        let windows = self.windows.read().expect("AppState window cache poisoned");
        windows.labels()
    }
}

#[cfg(test)]
mod tests {
    use super::WindowCache;

    #[test]
    fn should_preserve_a_cached_main_window_when_live_enumeration_loses_it() {
        let mut cached = WindowCache::new();
        cached.merge([("main".to_string(), 1)]);

        cached.merge(std::iter::empty());

        assert_eq!(cached.get("main"), Some(1));
    }

    #[test]
    fn should_remove_a_closed_window_from_the_cache() {
        let mut cached = WindowCache::new();
        cached.merge([("main".to_string(), 1)]);

        cached.remove("main");

        assert!(!cached.contains("main"));
    }

    #[test]
    fn should_merge_windows_discovered_later_without_inventing_child_handles() {
        let mut cached = WindowCache::new();
        cached.merge([("main".to_string(), 1)]);

        cached.merge([("settings".to_string(), 2)]);

        assert_eq!(cached.labels().len(), 2);
        assert_eq!(cached.get("main"), Some(1));
        assert_eq!(cached.get("settings"), Some(2));
        assert!(!cached.contains("child-webview"));
    }
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
