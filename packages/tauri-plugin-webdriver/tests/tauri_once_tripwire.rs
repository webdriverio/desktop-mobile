//! Tripwire for tauri-apps/tauri#16214: `Listener::once` panics when an emit queued while the
//! listener lock was held is replayed before the handler's own queued unlisten.
//!
//! Passes while the bug exists. `apply_window_change` (src/platform/executor.rs) avoids it with
//! `listen` and a take-once guard; this fails once Tauri stops panicking.

use std::panic::{self, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{Emitter, Listener};

const ONCE_PANIC: &str = "attempted to call handler more than once";
// The panic needs a re-emitter to run before the `once` handler, and Tauri iterates an event's
// handlers in HashMap order. With 32 re-emitters an attempt misses about 1 in 33, so retry.
const REEMITTERS: usize = 32;
const ATTEMPTS: usize = 10;

fn once_panic_message() -> Option<String> {
    let app = tauri::test::mock_app();
    for _ in 0..REEMITTERS {
        let handle = app.handle().clone();
        let emitted = AtomicBool::new(false);
        app.listen("tripwire", move |_| {
            // Tauri holds the listener lock while calling handlers, so this emit is queued.
            if !emitted.swap(true, Ordering::SeqCst) {
                let _ = handle.emit("tripwire", ());
            }
        });
    }
    app.once("tripwire", |_| {});

    let payload = panic::catch_unwind(AssertUnwindSafe(|| app.emit("tripwire", ()))).err()?;
    payload.downcast_ref::<String>().cloned().or_else(|| {
        payload
            .downcast_ref::<&str>()
            .map(|message| (*message).to_owned())
    })
}

#[test]
fn tauri_once_still_panics_on_a_replayed_queued_emit() {
    // Each expected panic would otherwise print its message and backtrace.
    let default_hook = panic::take_hook();
    panic::set_hook(Box::new(|_| {}));
    let message = (0..ATTEMPTS).find_map(|_| once_panic_message());
    panic::set_hook(default_hook);

    assert_eq!(
        message.as_deref(),
        Some(ONCE_PANIC),
        "Tauri's `once` no longer panics on a replayed queued emit, so tauri-apps/tauri#16214 \
         looks fixed. Delete this test; `apply_window_change` can drop its take-once guard once \
         the minimum supported Tauri includes the fix.",
    );
}
