//! Embedded-driver channel — in-process queue that lets the
//! `wdio-dioxus-embedded-driver` Axum server push JavaScript eval requests
//! to the webview without needing a native webview handle.
//!
//! Flow:
//! 1. The embedded Axum server calls [`push`] with a script + oneshot sender.
//! 2. The bridge's `__embedded_poll` command (called by the guest-js polling
//!    loop every ~10 ms) pops the next pending request via [`poll_next`] and
//!    returns it to JavaScript.
//! 3. JavaScript evaluates the script and calls `__embedded_result` with the
//!    serialised result; the bridge handler calls [`resolve`] which sends the
//!    result through the oneshot channel.
//! 4. The Axum handler `.await`s the oneshot receiver and returns the result
//!    to the WDIO test process.
//!
//! The channel is opt-in: it is only initialised when
//! `wdio-dioxus-embedded-driver` calls [`init`]. Without that call the poll
//! and resolve handlers return harmless no-ops.

use std::collections::VecDeque;
use std::sync::{Mutex, OnceLock};

use serde_json::Value;
use tokio::sync::oneshot;

pub struct EvalRequest {
  pub id: String,
  pub script: String,
  pub args: Vec<Value>,
  /// Receives the evaluated result (or an error message) from the JS side.
  pub result_tx: oneshot::Sender<Result<Value, String>>,
}

struct Channel {
  queue: Mutex<VecDeque<EvalRequest>>,
  /// Pending senders waiting for their result. Keyed by request ID.
  pending: Mutex<std::collections::HashMap<String, oneshot::Sender<Result<Value, String>>>>,
}

static CHANNEL: OnceLock<Channel> = OnceLock::new();

/// Initialise the embedded channel. Must be called by
/// `wdio-dioxus-embedded-driver` before the Axum server starts. Idempotent.
pub fn init() {
  CHANNEL.get_or_init(|| Channel {
    queue: Mutex::new(VecDeque::new()),
    pending: Mutex::new(std::collections::HashMap::new()),
  });
}

/// Returns `true` when the channel has been initialised (i.e. the embedded
/// driver is active). Used by the bridge to decide whether to register the
/// embedded-specific commands.
pub fn is_active() -> bool {
  CHANNEL.get().is_some()
}

/// Push a script for JS-side evaluation. Returns the receiver the caller
/// should await. Panics if the channel has not been initialised.
pub fn push(
  id: String,
  script: String,
  args: Vec<Value>,
  tx: oneshot::Sender<Result<Value, String>>,
) {
  let ch = CHANNEL.get().expect("embedded channel not initialised — call embedded::init() first");
  ch.queue.lock().expect("embedded queue poisoned").push_back(EvalRequest {
    id,
    script,
    args,
    result_tx: tx,
  });
}

/// Pop the next pending request. Returns `None` when the queue is empty.
/// Called by the `__embedded_poll` command handler on every JS poll tick.
pub fn poll_next() -> Option<(String, String, Vec<Value>)> {
  let ch = CHANNEL.get()?;
  let mut queue = ch.queue.lock().expect("embedded queue poisoned");
  let req = queue.pop_front()?;
  // Move the sender to the pending map so resolve() can find it later.
  ch.pending
    .lock()
    .expect("embedded pending poisoned")
    .insert(req.id.clone(), req.result_tx);
  Some((req.id, req.script, req.args))
}

/// Deliver a result for a pending request. Called by the `__embedded_result`
/// command handler after JS has evaluated the script.
pub fn resolve(id: &str, result: Result<Value, String>) {
  let ch = match CHANNEL.get() {
    Some(c) => c,
    None => return,
  };
  if let Some(tx) = ch.pending.lock().expect("embedded pending poisoned").remove(id) {
    // If the Axum handler already timed out, the receiver is gone. That's OK.
    let _ = tx.send(result);
  }
}

#[cfg(test)]
mod tests {
  use tokio::sync::Mutex;

  use super::*;

  // Serialize all tests that touch the process-global CHANNEL. The OnceLock
  // cannot be reset between tests, so concurrent access causes the drain-all
  // in one test to steal items pushed by another.
  static TEST_LOCK: Mutex<()> = Mutex::const_new(());

  fn setup() {
    init();
  }

  #[test]
  fn should_start_inactive_before_init() {
    init();
    init(); // idempotent — second call must not panic
    assert!(is_active());
  }

  #[tokio::test]
  async fn should_round_trip_an_eval_request() {
    let _guard = TEST_LOCK.lock().await;
    setup();
    while poll_next().is_some() {} // drain any leftovers from earlier tests

    let (tx, rx) = oneshot::channel();
    push("req-1".into(), "return 42".into(), vec![], tx);

    let (id, script, args) = poll_next().unwrap();
    assert_eq!(id, "req-1");
    assert_eq!(script, "return 42");
    assert!(args.is_empty());

    resolve(&id, Ok(serde_json::json!(42)));
    let result = rx.await.unwrap();
    assert_eq!(result.unwrap(), serde_json::json!(42));
  }

  #[tokio::test]
  async fn should_return_none_when_queue_is_empty() {
    let _guard = TEST_LOCK.lock().await;
    setup();
    while poll_next().is_some() {} // drain any leftovers from earlier tests
    assert!(poll_next().is_none());
  }

  #[tokio::test]
  async fn should_propagate_errors() {
    let _guard = TEST_LOCK.lock().await;
    setup();
    while poll_next().is_some() {} // drain any leftovers from earlier tests

    let (tx, rx) = oneshot::channel();
    push("req-err".into(), "throw new Error('boom')".into(), vec![], tx);
    let (id, ..) = poll_next().unwrap();
    resolve(&id, Err("boom".into()));
    let result = rx.await.unwrap();
    assert!(result.is_err());
    assert_eq!(result.unwrap_err(), "boom");
  }
}
