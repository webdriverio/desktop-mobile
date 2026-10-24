//! Whether the app was launched by `@wdio/dioxus-service`, which sets
//! `DIOXUS_WEBVIEW_AUTOMATION=true` in the app's environment.
//!
//! Once Dioxus lets apps allow WebKit automation, this is where the bridge
//! should turn it on; until then the `'external'` provider can't drive Linux
//! (webdriverio/desktop-mobile#713).

const ENV_VAR: &str = "DIOXUS_WEBVIEW_AUTOMATION";

/// True when `DIOXUS_WEBVIEW_AUTOMATION=true` is set in the process env.
pub fn is_requested() -> bool {
  std::env::var(ENV_VAR).as_deref() == Ok("true")
}

/// Log the current automation env-var state. Called from `crate::install`.
pub fn report() {
  if is_requested() {
    tracing::info!(target: "wdio_dioxus_bridge", "{ENV_VAR}=true: running under @wdio/dioxus-service");
  } else {
    tracing::debug!(target: "wdio_dioxus_bridge", "{ENV_VAR} not set — automation disabled");
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::sync::Mutex;

  // Tests run in parallel and the environment is process-wide.
  static ENV_LOCK: Mutex<()> = Mutex::new(());

  /// Holds the lock while ENV_VAR is set (or removed, for `None`), and
  /// removes it on drop so a failing test doesn't leak it.
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
