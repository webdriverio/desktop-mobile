//! Runs closures on the main thread with a window's [`DesktopService`], and so
//! with its native webview.
//!
//! wry's `WebView` isn't `Send`, so the embedded driver's server thread can't
//! touch it. [`attach`] spawns a long-lived task on the window's `VirtualDom`
//! from the `with_on_window` callback. Dioxus polls that task on the main
//! thread, and sending it a closure from any thread wakes the event loop, so
//! no app code is involved.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use dioxus_core::VirtualDom;
use dioxus_desktop::{DesktopContext, DesktopService};
use tokio::sync::mpsc;

/// A closure to run on the main thread against one window's webview.
pub type WebviewTask = Box<dyn FnOnce(&DesktopService) + Send>;

type Senders = Mutex<HashMap<String, mpsc::UnboundedSender<WebviewTask>>>;

static SENDERS: OnceLock<Senders> = OnceLock::new();

fn senders() -> &'static Senders {
  SENDERS.get_or_init(Senders::default)
}

/// Spawns the main-thread task for the window labelled `label`. Call it from
/// `with_on_window`, which runs before Dioxus builds the webview; the task
/// only reads the [`DesktopContext`] when a closure arrives, by which time
/// Dioxus has provided it.
pub fn attach(label: &str, dom: &mut VirtualDom) {
  let (tx, mut rx) = mpsc::unbounded_channel::<WebviewTask>();
  senders()
    .lock()
    .expect("webview task registry poisoned")
    .insert(label.to_string(), tx);

  dom.in_runtime(|| {
    dioxus_core::spawn_forever(async move {
      while let Some(task) = rx.recv().await {
        match dioxus_core::try_consume_context::<DesktopContext>() {
          Some(desktop) => task(&desktop),
          None => tracing::warn!("wdio-dioxus-bridge: webview task ran before the desktop context existed"),
        }
      }
    });
  });
}

/// Queues `task` to run on the main thread with the webview of the window
/// labelled `label`. Returns `false` if no live window has that label; a
/// closed window drops its `VirtualDom`, and with it the receiving task.
pub fn run_on_main_thread(label: &str, task: WebviewTask) -> bool {
  let mut senders = senders().lock().expect("webview task registry poisoned");
  let Some(tx) = senders.get(label) else {
    return false;
  };
  if tx.send(task).is_err() {
    senders.remove(label);
    return false;
  }
  true
}

#[cfg(test)]
mod tests {
  use dioxus_core::{Element, VNode, VirtualDom};

  use super::*;

  fn app() -> Element {
    VNode::empty()
  }

  #[test]
  fn should_refuse_a_task_for_an_unknown_window() {
    assert!(!run_on_main_thread("never-attached", Box::new(|_| {})));
  }

  #[test]
  fn should_queue_a_task_for_an_attached_window() {
    let mut dom = VirtualDom::new(app);
    attach("attached-window", &mut dom);
    assert!(run_on_main_thread("attached-window", Box::new(|_| {})));
  }

  #[test]
  fn should_refuse_a_task_once_the_window_is_gone() {
    let mut dom = VirtualDom::new(app);
    attach("closed-window", &mut dom);
    drop(dom);
    assert!(!run_on_main_thread("closed-window", Box::new(|_| {})));
  }
}
