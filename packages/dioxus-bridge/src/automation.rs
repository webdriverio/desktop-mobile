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

  // Use a unique env-var name in tests to avoid interference between tests.
  // The actual `is_requested` reads from the const ENV_VAR — we exercise the
  // public surface via std::env::set_var/remove_var.

  #[test]
  fn should_report_false_when_env_var_unset() {
    // SAFETY: tests are single-threaded by default; setting env vars is
    // valid in this context.
    unsafe {
      std::env::remove_var(ENV_VAR);
    }
    assert!(!is_requested());
  }

  #[test]
  fn should_report_true_when_env_var_is_true() {
    unsafe {
      std::env::set_var(ENV_VAR, "true");
    }
    assert!(is_requested());
    unsafe {
      std::env::remove_var(ENV_VAR);
    }
  }

  #[test]
  fn should_report_false_when_env_var_is_other_value() {
    unsafe {
      std::env::set_var(ENV_VAR, "yes");
    }
    assert!(!is_requested());
    unsafe {
      std::env::set_var(ENV_VAR, "1");
    }
    assert!(!is_requested());
    unsafe {
      std::env::set_var(ENV_VAR, "");
    }
    assert!(!is_requested());
    unsafe {
      std::env::remove_var(ENV_VAR);
    }
  }
}
