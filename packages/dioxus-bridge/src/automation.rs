//! Automation env-var detection.
//!
//! `@wdio/dioxus-service`'s launcher sets `DIOXUS_WEBVIEW_AUTOMATION=true` on
//! the spawned driver process (which then propagates to the Dioxus app via
//! msedgedriver / WebKitWebDriver). The bridge crate reads this at startup
//! to detect "we're running under test" and to (eventually) flip Wry's
//! `WebContext::set_allows_automation`.
//!
//! **v1 status:** Dioxus's public Config API doesn't expose `WebContext`,
//! so this function currently only *reports* whether the env var is set
//! (via the `tracing` crate). Flipping the flag requires an upstream Dioxus
//! PR — see `spike/FINDINGS.md`. The function exists now so the API surface
//! is in place; once the upstream PR lands, this module will gain the call
//! to `WebContext::set_allows_automation(true)` and Linux `'external'`
//! provider unblocks.

const ENV_VAR: &str = "DIOXUS_WEBVIEW_AUTOMATION";

/// True when `DIOXUS_WEBVIEW_AUTOMATION=true` is set in the process env.
pub fn is_requested() -> bool {
  std::env::var(ENV_VAR).as_deref() == Ok("true")
}

/// Log the current automation env-var state. Called from `crate::install`.
pub fn report() {
  if is_requested() {
    tracing::info!(
      target: "wdio_dioxus_bridge",
      "{ENV_VAR}=true detected — running under @wdio/dioxus-service. Note: in v1, \
       this crate cannot flip Wry's automation mode from a third-party hook. See \
       spike/FINDINGS.md."
    );
  } else {
    tracing::debug!(target: "wdio_dioxus_bridge", "{ENV_VAR} not set — automation disabled");
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::sync::Mutex;

  // Cargo runs unit tests in this module *concurrently* by default (one
  // thread per logical CPU). `std::env::set_var` / `remove_var` mutate the
  // whole process environment, so without serialisation two tests racing
  // each other can read stale values. We guard every env-var mutation
  // with this lock to keep them deterministic.
  static ENV_LOCK: Mutex<()> = Mutex::new(());

  /// RAII helper: take the env-var lock, set ENV_VAR to the supplied value
  /// (or remove it when `None`), and ensure it's removed when the guard
  /// drops so a test failure in the middle never leaks state.
  struct EnvGuard {
    _lock: std::sync::MutexGuard<'static, ()>,
  }

  impl EnvGuard {
    fn new(value: Option<&str>) -> Self {
      let lock = ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
      // SAFETY: we hold the process-wide lock for the duration of the
      // EnvGuard, so no other test in this module can race us.
      unsafe {
        match value {
          Some(v) => std::env::set_var(ENV_VAR, v),
          None => std::env::remove_var(ENV_VAR),
        }
      }
      Self { _lock: lock }
    }
  }

  impl Drop for EnvGuard {
    fn drop(&mut self) {
      // SAFETY: still inside the locked critical section.
      unsafe {
        std::env::remove_var(ENV_VAR);
      }
    }
  }

  #[test]
  fn should_report_false_when_env_var_unset() {
    let _g = EnvGuard::new(None);
    assert!(!is_requested());
  }

  #[test]
  fn should_report_true_when_env_var_is_true() {
    let _g = EnvGuard::new(Some("true"));
    assert!(is_requested());
  }

  #[test]
  fn should_report_false_when_env_var_is_yes() {
    let _g = EnvGuard::new(Some("yes"));
    assert!(!is_requested());
  }

  #[test]
  fn should_report_false_when_env_var_is_one() {
    let _g = EnvGuard::new(Some("1"));
    assert!(!is_requested());
  }

  #[test]
  fn should_report_false_when_env_var_is_empty_string() {
    let _g = EnvGuard::new(Some(""));
    assert!(!is_requested());
  }
}
