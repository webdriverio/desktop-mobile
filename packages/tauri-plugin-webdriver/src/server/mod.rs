use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, RwLock as SyncRwLock};

use tauri::{AppHandle, Manager, Runtime, Webview, WebviewWindow, WindowEvent};
use tokio::runtime::Runtime as TokioRuntime;
use tokio::sync::RwLock;

pub mod handlers;
pub mod response;
pub mod router;

use crate::platform::{create_executor, FrameId, PlatformExecutor};
use crate::server::response::WebDriverErrorResponse;
use crate::webdriver::{SessionManager, Timeouts};

struct WindowCache<T> {
    windows: SyncRwLock<HashMap<String, T>>,
}

impl<T: Clone> WindowCache<T> {
    fn new() -> Self {
        Self {
            windows: SyncRwLock::new(HashMap::new()),
        }
    }

    fn merge(&self, live_windows: impl IntoIterator<Item = (String, T)>) {
        self.merge_with(|| live_windows);
    }

    fn merge_with<I>(&self, get_live_windows: impl FnOnce() -> I)
    where
        I: IntoIterator<Item = (String, T)>,
    {
        self.windows
            .write()
            .expect("WindowCache poisoned")
            .extend(get_live_windows());
    }

    fn get(&self, window_label: &str) -> Option<T> {
        self.windows
            .read()
            .expect("WindowCache poisoned")
            .get(window_label)
            .cloned()
    }

    fn remove(&self, window_label: &str) {
        self.windows
            .write()
            .expect("WindowCache poisoned")
            .remove(window_label);
    }

    fn contains(&self, window_label: &str) -> bool {
        self.windows
            .read()
            .expect("WindowCache poisoned")
            .contains_key(window_label)
    }

    fn labels(&self) -> Vec<String> {
        self.windows
            .read()
            .expect("WindowCache poisoned")
            .keys()
            .cloned()
            .collect()
    }
}

/// Shared state for the `WebDriver` server
pub struct AppState<R: Runtime> {
    pub app: AppHandle<R>,
    pub sessions: RwLock<SessionManager>,
    windows: Arc<WindowRegistry<R>>,
}

impl<R: Runtime + 'static> AppState<R> {
    pub fn new(app: AppHandle<R>, windows: Arc<WindowRegistry<R>>) -> Self {
        let state = Self {
            app,
            sessions: RwLock::new(SessionManager::new()),
            windows,
        };
        state.refresh_windows();
        state
    }

    fn refresh_windows(&self) {
        self.windows.refresh(&self.app);
    }

    fn get_window(&self, window_label: &str) -> Option<WebviewWindow<R>> {
        self.refresh_windows();
        self.windows.get(window_label)
    }

    pub fn remove_window_label(&self, window_label: &str) {
        self.windows.remove(window_label);
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
        self.windows.contains(window_label)
    }

    /// Get all window labels
    pub fn get_window_labels(&self) -> Vec<String> {
        self.refresh_windows();
        self.windows.labels()
    }
}

/// Retains top-level windows that Tauri stops enumerating after they gain child webviews.
pub(crate) struct WindowRegistry<R: Runtime> {
    windows: WindowCache<WebviewWindow<R>>,
}

impl<R: Runtime> WindowRegistry<R> {
    pub(crate) fn new() -> Self {
        Self {
            windows: WindowCache::new(),
        }
    }

    pub(crate) fn register(self: &Arc<Self>, webview: &Webview<R>) {
        let window = webview.window();
        if webview.label() != window.label() {
            return;
        }

        let label = window.label().to_string();
        let Some(webview_window) = webview.app_handle().get_webview_window(&label) else {
            return;
        };
        self.merge([(label.clone(), webview_window)]);

        let windows = Arc::clone(self);
        window.on_window_event(move |event| {
            if matches!(event, WindowEvent::Destroyed) {
                windows.remove(&label);
            }
        });
    }

    fn merge(&self, live_windows: impl IntoIterator<Item = (String, WebviewWindow<R>)>) {
        self.windows.merge(live_windows);
    }

    fn refresh(&self, app: &AppHandle<R>) {
        self.windows.merge_with(|| app.webview_windows());
    }

    fn get(&self, window_label: &str) -> Option<WebviewWindow<R>> {
        self.windows.get(window_label)
    }

    fn remove(&self, window_label: &str) {
        self.windows.remove(window_label);
    }

    fn contains(&self, window_label: &str) -> bool {
        self.windows.contains(window_label)
    }

    fn labels(&self) -> Vec<String> {
        self.windows.labels()
    }
}

#[cfg(test)]
mod tests {
    use super::WindowCache;
    use std::sync::{mpsc, Arc};
    use std::thread;

    #[test]
    fn should_preserve_a_cached_main_window_when_live_enumeration_loses_it() {
        let cached = WindowCache::new();
        cached.merge([("main".to_string(), 1)]);

        cached.merge(std::iter::empty());

        assert_eq!(cached.get("main"), Some(1));
    }

    #[test]
    fn should_remove_a_closed_window_from_the_cache() {
        let cached = WindowCache::new();
        cached.merge([("main".to_string(), 1)]);

        cached.remove("main");

        assert!(!cached.contains("main"));
    }

    #[test]
    fn should_merge_windows_discovered_later_without_inventing_child_handles() {
        let cached = WindowCache::new();
        cached.merge([("main".to_string(), 1)]);

        cached.merge([("settings".to_string(), 2)]);

        assert_eq!(cached.labels().len(), 2);
        assert_eq!(cached.get("main"), Some(1));
        assert_eq!(cached.get("settings"), Some(2));
        assert!(!cached.contains("child-webview"));
    }

    #[test]
    fn should_not_restore_a_window_removed_during_a_live_refresh() {
        let cached = Arc::new(WindowCache::new());
        cached.merge([("main".to_string(), 1)]);
        let (refresh_started_tx, refresh_started_rx) = mpsc::channel();
        let (continue_refresh_tx, continue_refresh_rx) = mpsc::channel();

        let refresh_cache = Arc::clone(&cached);
        let refresh = thread::spawn(move || {
            refresh_cache.merge_with(|| {
                refresh_started_tx.send(()).unwrap();
                continue_refresh_rx.recv().unwrap();
                [("main".to_string(), 1)]
            });
        });
        refresh_started_rx.recv().unwrap();

        let remove_cache = Arc::clone(&cached);
        let remove = thread::spawn(move || remove_cache.remove("main"));
        continue_refresh_tx.send(()).unwrap();

        refresh.join().unwrap();
        remove.join().unwrap();
        assert!(!cached.contains("main"));
    }
}

/// Start the `WebDriver` HTTP server on the specified port
pub fn start<R: Runtime + 'static>(app: AppHandle<R>, port: u16, windows: Arc<WindowRegistry<R>>) {
    std::thread::spawn(move || {
        let rt = match TokioRuntime::new() {
            Ok(rt) => rt,
            Err(e) => {
                tracing::error!("Failed to create Tokio runtime for WebDriver server: {}", e);
                return;
            }
        };

        rt.block_on(async {
            let state = Arc::new(AppState::new(app, windows));
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
