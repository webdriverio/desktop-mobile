use tauri::{
  plugin::{Builder, TauriPlugin},
  Runtime,
};

mod error;
#[cfg(target_os = "macos")]
mod eval_channel;
#[cfg(desktop)]
mod platform;
#[cfg(desktop)]
mod server;
#[cfg(desktop)]
mod webdriver;

pub use error::{Error, Result};

/// Environment variable that starts the server and sets its port
pub const PORT_ENV_VAR: &str = "TAURI_WEBDRIVER_PORT";

/// Initializes the plugin. It starts the `WebDriver` server only when `TAURI_WEBDRIVER_PORT` is
/// set to a valid port, as `@wdio/tauri-service` does when it launches the app, so a debug build run
/// outside the tests opens no port.
#[must_use]
pub fn init<R: Runtime>() -> TauriPlugin<R> {
  match std::env::var(PORT_ENV_VAR) {
    Ok(value) => match requested_port(&value) {
      Some(port) => init_with_port(port),
      None => not_started(Some(value)),
    },
    Err(_) => not_started(None),
  }
}

fn requested_port(value: &str) -> Option<u16> {
  value.parse::<std::num::NonZeroU16>().ok().map(std::num::NonZeroU16::get)
}

fn not_started<R: Runtime>(invalid_value: Option<String>) -> TauriPlugin<R> {
  Builder::new("wdio-webdriver")
    .setup(move |_app, _api| {
      match &invalid_value {
        Some(value) => tracing::warn!(
          "{PORT_ENV_VAR}={value:?} is not a valid port; WebDriver server not started"
        ),
        None => tracing::debug!("{PORT_ENV_VAR} is not set; WebDriver server not started"),
      }
      Ok(())
    })
    .build()
}

/// Initializes the plugin and starts the `WebDriver` server on `port` whenever the app runs.
///
/// This ignores `TAURI_WEBDRIVER_PORT`, so gate the call yourself if the app should open the port
/// only under test.
#[cfg(desktop)]
#[must_use]
pub fn init_with_port<R: Runtime>(port: u16) -> TauriPlugin<R> {
  use tauri::Manager;

  Builder::new("wdio-webdriver")
    .setup(move |app, _api| {
      // Manage async script state for native message handlers (Windows only)
      #[cfg(target_os = "windows")]
      app.manage(platform::AsyncScriptState::default());
      // Serialize concurrent ExecuteScript calls per webview (Windows only)
      #[cfg(target_os = "windows")]
      app.manage(platform::ScriptExecutionLocks::default());

      // Manage per-window alert state
      app.manage(platform::AlertStateManager::default());

      // Arc so the (non-generic) objc2 message handler can hold its own clone; see eval_channel.
      #[cfg(target_os = "macos")]
      app.manage(std::sync::Arc::new(eval_channel::EvalResultRegistry::default()));

      // Start the macOS headless run-loop pump early (before any webview loads); Once-guarded,
      // so the on_webview_ready registration remains a fallback. See #540.
      #[cfg(target_os = "macos")]
      platform::start_runloop_pump_early(app.app_handle());

      // Start the WebDriver HTTP server
      let app_handle = app.app_handle().clone();
      server::start(app_handle, port);
      tracing::info!("WDIO WebDriver plugin initialized on port {port}");

      Ok(())
    })
    .js_init_script_on_all_frames(platform::key_input::install_element_events_js())
    .on_webview_ready(|webview| {
      platform::register_webview_handlers(&webview);
    })
    .build()
}

/// Initializes the plugin with a custom port.
///
/// On Android and iOS the plugin registers but does nothing: the embedded driver is desktop-only.
#[cfg(mobile)]
#[must_use]
pub fn init_with_port<R: Runtime>(_port: u16) -> TauriPlugin<R> {
  Builder::new("wdio-webdriver")
    .setup(|_app, _api| {
      tracing::warn!("tauri-plugin-wdio-webdriver is desktop-only; not started on mobile");
      Ok(())
    })
    .build()
}

#[cfg(test)]
mod tests {
  use super::requested_port;

  #[test]
  fn accepts_a_valid_port() {
    assert_eq!(requested_port("4445"), Some(4445));
    assert_eq!(requested_port("65535"), Some(65535));
  }

  #[test]
  fn rejects_an_invalid_port() {
    for value in ["", "0", "65536", "-1", "port", " 4445"] {
      assert_eq!(requested_port(value), None, "{value:?}");
    }
  }
}
