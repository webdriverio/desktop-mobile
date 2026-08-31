use std::collections::{HashMap, VecDeque};
use std::net::SocketAddr;
use std::sync::{Arc, RwLock as SyncRwLock};

use tauri::{AppHandle, Manager, Runtime, Webview, WebviewWindow, Window};
use tokio::runtime::Runtime as TokioRuntime;
use tokio::sync::RwLock;

pub mod handlers;
pub mod response;
pub mod router;

use crate::platform::{create_executor, FrameId, PlatformExecutor};
use crate::server::response::WebDriverErrorResponse;
use crate::webdriver::{SessionManager, Timeouts};

struct WindowCache<T> {
    state: SyncRwLock<WindowCacheState<T>>,
}

struct WindowCacheState<T> {
    windows: HashMap<String, CachedWindow<T>>,
    closing: HashMap<String, u64>,
    registrations: HashMap<String, VecDeque<u64>>,
    lifecycles: HashMap<String, VecDeque<u64>>,
    next_generation: u64,
}

struct CachedWindow<T> {
    generation: u64,
    value: T,
}

impl<T: Clone> WindowCache<T> {
    fn new() -> Self {
        Self {
            state: SyncRwLock::new(WindowCacheState {
                windows: HashMap::new(),
                closing: HashMap::new(),
                registrations: HashMap::new(),
                lifecycles: HashMap::new(),
                next_generation: 0,
            }),
        }
    }

    fn reserve(&self, label: &str) -> u64 {
        let mut state = self.state.write().expect("WindowCache poisoned");
        let generation = Self::allocate_generation(&mut state);
        state
            .registrations
            .entry(label.to_string())
            .or_default()
            .push_back(generation);
        state
            .lifecycles
            .entry(label.to_string())
            .or_default()
            .push_back(generation);
        generation
    }

    fn publish_reserved_with(&self, label: &str, create_value: impl FnOnce() -> Option<T>) -> bool {
        let generation = {
            let mut state = self.state.write().expect("WindowCache poisoned");
            let registrations = match state.registrations.get_mut(label) {
                Some(registrations) => registrations,
                None => return false,
            };
            let generation = match registrations.pop_front() {
                Some(generation) => generation,
                None => return false,
            };
            if registrations.is_empty() {
                state.registrations.remove(label);
            }
            generation
        };
        match create_value() {
            Some(value) => self.publish(label.to_string(), value, generation),
            None => false,
        }
    }

    fn publish(&self, label: String, value: T, generation: u64) -> bool {
        let mut state = self.state.write().expect("WindowCache poisoned");
        if state
            .windows
            .get(&label)
            .is_some_and(|window| window.generation > generation)
            || state
                .closing
                .get(&label)
                .is_some_and(|closing_generation| *closing_generation >= generation)
        {
            return false;
        }
        state.closing.remove(&label);
        state
            .windows
            .insert(label, CachedWindow { generation, value });
        true
    }

    fn get(&self, window_label: &str) -> Option<T> {
        let state = self.state.read().expect("WindowCache poisoned");
        if state.closing.contains_key(window_label) {
            return None;
        }
        state
            .windows
            .get(window_label)
            .map(|window| &window.value)
            .cloned()
    }

    fn begin_close(&self, window_label: &str) -> Option<(T, u64)> {
        let mut state = self.state.write().expect("WindowCache poisoned");
        if state.closing.contains_key(window_label) {
            return None;
        }
        let (value, generation) = state
            .windows
            .get(window_label)
            .map(|window| (window.value.clone(), window.generation))?;
        state.closing.insert(window_label.to_string(), generation);
        Some((value, generation))
    }

    fn commit_close(&self, window_label: &str, generation: u64) {
        let mut state = self.state.write().expect("WindowCache poisoned");
        if state.closing.get(window_label) != Some(&generation) {
            return;
        }
        if state
            .windows
            .get(window_label)
            .is_some_and(|window| window.generation == generation)
        {
            state.windows.remove(window_label);
        }
    }

    fn rollback_close(&self, window_label: &str, generation: u64) {
        let mut state = self.state.write().expect("WindowCache poisoned");
        if state.closing.get(window_label) == Some(&generation) {
            state.closing.remove(window_label);
        }
    }

    fn destroyed(&self, window_label: &str, generation: u64) {
        let mut state = self.state.write().expect("WindowCache poisoned");
        if state
            .windows
            .get(window_label)
            .is_some_and(|window| window.generation > generation)
            || state
                .closing
                .get(window_label)
                .is_some_and(|closing_generation| *closing_generation > generation)
        {
            return;
        }
        if state
            .windows
            .get(window_label)
            .is_some_and(|window| window.generation == generation)
        {
            state.windows.remove(window_label);
        }
        if let Some(registrations) = state.registrations.get_mut(window_label) {
            registrations.retain(|registration| *registration != generation);
            if registrations.is_empty() {
                state.registrations.remove(window_label);
            }
        }
        state
            .closing
            .entry(window_label.to_string())
            .and_modify(|closing_generation| {
                *closing_generation = (*closing_generation).max(generation);
            })
            .or_insert(generation);
    }

    fn destroyed_label(&self, window_label: &str) {
        let generation = {
            let mut state = self.state.write().expect("WindowCache poisoned");
            let generations = match state.lifecycles.get_mut(window_label) {
                Some(generations) => generations,
                None => return,
            };
            let generation = match generations.pop_front() {
                Some(generation) => generation,
                None => return,
            };
            if generations.is_empty() {
                state.lifecycles.remove(window_label);
            }
            generation
        };
        self.destroyed(window_label, generation);
    }

    fn contains(&self, window_label: &str) -> bool {
        let state = self.state.read().expect("WindowCache poisoned");
        !state.closing.contains_key(window_label) && state.windows.contains_key(window_label)
    }

    fn labels(&self) -> Vec<String> {
        let state = self.state.read().expect("WindowCache poisoned");
        state
            .windows
            .keys()
            .filter(|label| !state.closing.contains_key(*label))
            .cloned()
            .collect()
    }

    fn allocate_generation(state: &mut WindowCacheState<T>) -> u64 {
        let generation = state.next_generation;
        state.next_generation = state
            .next_generation
            .checked_add(1)
            .expect("WindowCache generation overflowed");
        generation
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
        Self {
            app,
            sessions: RwLock::new(SessionManager::new()),
            windows,
        }
    }

    fn get_window(&self, window_label: &str) -> Option<WebviewWindow<R>> {
        self.windows.get(window_label)
    }

    fn begin_close_window(&self, window_label: &str) -> Option<(WebviewWindow<R>, u64)> {
        self.windows.begin_close(window_label)
    }

    fn commit_close_window(&self, window_label: &str, generation: u64) {
        self.windows.commit_close(window_label, generation);
    }

    fn rollback_close_window(&self, window_label: &str, generation: u64) {
        self.windows.rollback_close(window_label, generation);
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
        self.windows.contains(window_label)
    }

    /// Get all window labels
    pub fn get_window_labels(&self) -> Vec<String> {
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

    pub(crate) fn reserve(&self, window: Window<R>) {
        self.windows.reserve(window.label());
    }

    pub(crate) fn register(&self, webview: &Webview<R>) -> bool {
        let label = webview.label();
        self.windows
            .publish_reserved_with(label, || webview.app_handle().get_webview_window(label))
    }

    fn get(&self, window_label: &str) -> Option<WebviewWindow<R>> {
        self.windows.get(window_label)
    }

    fn begin_close(&self, window_label: &str) -> Option<(WebviewWindow<R>, u64)> {
        self.windows.begin_close(window_label)
    }

    fn commit_close(&self, window_label: &str, generation: u64) {
        self.windows.commit_close(window_label, generation);
    }

    fn rollback_close(&self, window_label: &str, generation: u64) {
        self.windows.rollback_close(window_label, generation);
    }

    pub(crate) fn destroyed_label(&self, window_label: &str) {
        self.windows.destroyed_label(window_label);
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

    fn publish<T: Clone>(cached: &WindowCache<T>, label: &str, value: T) -> u64 {
        let generation = cached.reserve(label);
        assert!(cached.publish_reserved_with(label, || Some(value)));
        generation
    }

    #[test]
    fn should_preserve_a_cached_main_window_after_live_enumeration_loses_it() {
        let cached = WindowCache::new();
        publish(&cached, "main", 1);

        assert_eq!(cached.get("main"), Some(1));
    }

    #[test]
    fn should_remove_a_closed_window_from_the_cache() {
        let cached = WindowCache::new();
        publish(&cached, "main", 1);

        let (_, generation) = cached.begin_close("main").unwrap();
        cached.commit_close("main", generation);

        assert!(!cached.contains("main"));
    }

    #[test]
    fn should_register_later_top_level_windows_without_inventing_child_handles() {
        let cached = WindowCache::new();
        publish(&cached, "main", 1);
        publish(&cached, "settings", 2);

        assert_eq!(cached.labels().len(), 2);
        assert_eq!(cached.get("main"), Some(1));
        assert_eq!(cached.get("settings"), Some(2));
        assert!(!cached.contains("child-webview"));
    }

    #[test]
    fn should_not_restore_a_closing_window_from_a_stale_live_snapshot() {
        let cached = WindowCache::new();
        publish(&cached, "main", 1);

        let (_, generation) = cached.begin_close("main").unwrap();
        cached.commit_close("main", generation);

        assert!(!cached.contains("main"));
    }

    #[test]
    fn should_restore_a_window_when_destroy_fails() {
        let cached = WindowCache::new();
        publish(&cached, "main", 1);

        let (_, generation) = cached.begin_close("main").unwrap();
        assert!(!cached.contains("main"));
        cached.rollback_close("main", generation);

        assert_eq!(cached.get("main"), Some(1));
    }

    #[test]
    fn should_keep_a_new_window_when_an_old_window_with_the_same_label_is_destroyed() {
        let cached = WindowCache::new();
        let old_generation = publish(&cached, "main", 1);
        let (_, closing_generation) = cached.begin_close("main").unwrap();
        cached.commit_close("main", closing_generation);
        let new_generation = publish(&cached, "main", 2);
        cached.destroyed_label("main");

        assert_ne!(old_generation, new_generation);
        assert_eq!(cached.get("main"), Some(2));

        cached.destroyed_label("main");
        assert!(!cached.contains("main"));
    }

    #[test]
    fn should_reject_a_registration_destroyed_before_it_is_published() {
        let cached = WindowCache::new();
        cached.reserve("main");

        cached.destroyed_label("main");

        assert!(!cached.publish_reserved_with("main", || Some(1)));
        assert!(!cached.contains("main"));
    }

    #[test]
    fn should_preserve_a_new_pending_registration_after_an_old_destroy() {
        let cached = WindowCache::new();
        cached.reserve("main");
        cached.reserve("main");

        cached.destroyed_label("main");

        assert!(cached.publish_reserved_with("main", || Some(2)));
        assert_eq!(cached.get("main"), Some(2));
    }

    #[test]
    fn should_ignore_an_unreserved_child_without_creating_its_window() {
        let cached = WindowCache::new();
        publish(&cached, "main", 1);
        let mut factory_called = false;

        assert!(!cached.publish_reserved_with("child", || {
            factory_called = true;
            Some(2)
        }));
        assert!(!factory_called);
        assert!(!cached.contains("child"));
    }

    #[test]
    fn should_publish_same_label_registrations_in_lifecycle_order() {
        let cached = WindowCache::new();
        let older_generation = cached.reserve("main");
        let newer_generation = cached.reserve("main");

        assert!(cached.publish_reserved_with("main", || Some(1)));
        assert!(cached.publish_reserved_with("main", || Some(2)));
        cached.destroyed_label("main");

        assert_ne!(older_generation, newer_generation);
        assert_eq!(cached.get("main"), Some(2));
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
