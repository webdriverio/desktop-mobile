use std::collections::HashMap;
use std::sync::Mutex;

use serde_json::Value;
use tokio::sync::oneshot;

/// Correlates DirectEval results the webview reports back out-of-band, keyed by id.
///
/// The macOS DirectEval path dispatches its script fire-and-forget via `evaluateJavaScript` (no
/// completion handler) and takes the result solely from here: the script posts `{ id, result }` to a
/// `WKScriptMessageHandler`, which calls `complete` to wake the executor awaiting `register`. The
/// app's own `core.invoke` IPC is kept resolving on a headless runner by the standalone main run-loop
/// pump (`start_runloop_pump`), not by holding a `callAsyncJavaScript` activity open — so there is no
/// completion for macOS 26.x WebKit to reclaim. Mirrors the Windows `AsyncScriptState` native-handler
/// pattern. https://github.com/webdriverio/desktop-mobile/issues/569
#[derive(Default)]
pub struct EvalResultRegistry {
    pending: Mutex<HashMap<String, oneshot::Sender<Value>>>,
}

impl EvalResultRegistry {
    pub fn register(&self, id: String) -> oneshot::Receiver<Value> {
        let (tx, rx) = oneshot::channel();
        if let Ok(mut pending) = self.pending.lock() {
            pending.insert(id, tx);
        }
        rx
    }

    /// No-op if `id` is unknown or already completed, so a duplicate or late report is harmless.
    pub fn complete(&self, id: &str, result: Value) {
        if let Ok(mut pending) = self.pending.lock() {
            if let Some(tx) = pending.remove(id) {
                let _ = tx.send(result);
            }
        }
    }

    /// Drop a pending registration (e.g. on timeout) so its sender doesn't leak.
    pub fn cancel(&self, id: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.remove(id);
        }
    }
}
