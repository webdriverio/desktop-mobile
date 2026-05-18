//! Window-state registry for multi-window Dioxus apps.
//!
//! Dioxus 0.7 windows have no built-in label concept — each is identified by
//! a [`WindowId`] from `tao`. The bridge auto-labels windows in creation
//! order so `@wdio/dioxus-service` can route `switchWindow('main')` /
//! `switchWindow('window-1')` calls without any user wiring:
//!
//! | Order | Label       |
//! |-------|-------------|
//! | 1st   | `main`      |
//! | 2nd   | `window-1`  |
//! | 3rd   | `window-2`  |
//! | ...   | ...         |
//!
//! Labels are never reused: closing the `main` window and opening a new one
//! produces `window-1`, not a recycled `main`. This keeps test code
//! deterministic across window churn.
//!
//! The registry is process-global because Dioxus's `Config::with_on_window`
//! callback has no per-`Config` context to thread state through, and only
//! one bridge runs per process anyway. Entries hold a [`Weak<Window>`] so
//! closed windows can be detected without keeping them alive past their
//! natural lifetime.
//!
//! Focus/destroy events are **not** observed — Dioxus exposes neither in
//! `with_on_window`. Active-window detection walks the live entries and
//! calls [`Window::is_focused`] on each at query time.

use std::sync::{Arc, Mutex, OnceLock, Weak};

use dioxus_desktop::tao::window::{Window, WindowId};
use serde::Serialize;

/// Per-window snapshot exposed over the `wdio://` channel.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct WindowState {
  pub label: String,
  pub title: String,
  pub is_visible: bool,
  pub is_focused: bool,
}

struct Entry {
  id: WindowId,
  label: String,
  window: Weak<Window>,
}

#[derive(Default)]
struct Registry {
  entries: Mutex<Vec<Entry>>,
  /// Monotonic counter: total windows ever registered. Drives labelling
  /// so closing 'main' and opening a new window produces `window-N`,
  /// never a recycled `main`. Independent of `entries.len()` so the
  /// backing `Vec` can be pruned of dead entries without disturbing labels.
  total_registered: Mutex<usize>,
}

static REGISTRY: OnceLock<Registry> = OnceLock::new();

fn registry() -> &'static Registry {
  REGISTRY.get_or_init(Registry::default)
}

/// Allocate the next label given how many windows have **ever** been
/// registered (live or dead). Pulled out so the labelling rule can be
/// unit-tested without spinning a real Window.
pub(crate) fn allocate_label(total_registered: usize) -> String {
  if total_registered == 0 {
    "main".to_string()
  } else {
    format!("window-{}", total_registered)
  }
}

/// Register a freshly-built window. Returns the label assigned to it.
/// Re-registering the same [`WindowId`] is a no-op that returns the
/// already-assigned label.
///
/// Each call prunes entries whose `Weak<Window>` has expired so the
/// backing `Vec` stays proportional to the number of *live* windows in
/// long-running test suites that churn windows repeatedly. Labels remain
/// stable across GC because the counter is monotonic.
pub fn register_window(window: &Arc<Window>) -> String {
  let r = registry();
  let mut entries = r.entries.lock().expect("window-state registry poisoned");
  let id = window.id();
  if let Some(existing) = entries.iter().find(|e| e.id == id) {
    return existing.label.clone();
  }
  entries.retain(|e| e.window.upgrade().is_some());
  let mut counter = r.total_registered.lock().expect("window-state registry poisoned");
  let label = allocate_label(*counter);
  *counter += 1;
  entries.push(Entry {
    id,
    label: label.clone(),
    window: Arc::downgrade(window),
  });
  label
}

/// All currently-live window labels in registration order.
pub fn list_labels() -> Vec<String> {
  let r = registry();
  let entries = r.entries.lock().expect("window-state registry poisoned");
  entries
    .iter()
    .filter(|e| e.window.upgrade().is_some())
    .map(|e| e.label.clone())
    .collect()
}

/// Label of the currently-focused window, if any. Walks the live entries
/// looking for the first whose [`Window::is_focused`] returns true.
pub fn get_active_label() -> Option<String> {
  let r = registry();
  let entries = r.entries.lock().expect("window-state registry poisoned");
  entries.iter().find_map(|e| {
    let w = e.window.upgrade()?;
    if w.is_focused() {
      Some(e.label.clone())
    } else {
      None
    }
  })
}

/// Snapshot every live window's label, title, visibility, and focus state.
pub fn get_window_states() -> Vec<WindowState> {
  let r = registry();
  let entries = r.entries.lock().expect("window-state registry poisoned");
  entries
    .iter()
    .filter_map(|e| {
      let w = e.window.upgrade()?;
      Some(WindowState {
        label: e.label.clone(),
        title: w.title(),
        is_visible: w.is_visible(),
        is_focused: w.is_focused(),
      })
    })
    .collect()
}

/// Find the label for a given window id, regardless of liveness. Used by
/// the bridge's invoke handlers to attribute incoming requests to a window.
pub fn label_for_id(id: WindowId) -> Option<String> {
  let r = registry();
  let entries = r.entries.lock().expect("window-state registry poisoned");
  entries
    .iter()
    .find(|e| e.id == id)
    .map(|e| e.label.clone())
}


#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn should_label_the_first_window_main() {
    assert_eq!(allocate_label(0), "main");
  }

  #[test]
  fn should_label_subsequent_windows_with_a_numeric_suffix() {
    assert_eq!(allocate_label(1), "window-1");
    assert_eq!(allocate_label(2), "window-2");
    assert_eq!(allocate_label(42), "window-42");
  }

  #[test]
  fn should_never_reuse_a_main_label_after_closure() {
    // Three windows registered, then the first closes; the next allocation
    // must be 'window-3', not 'main'. The monotonic counter passed to
    // allocate_label is the source of truth — register_window keeps the
    // counter independent of entries.len() so GC can prune dead entries.
    assert_eq!(allocate_label(3), "window-3");
  }
}
