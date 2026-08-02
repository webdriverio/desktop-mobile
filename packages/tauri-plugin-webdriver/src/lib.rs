use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

#[cfg(desktop)]
mod desktop;
#[cfg(mobile)]
mod mobile;

mod error;
#[cfg(target_os = "macos")]
mod eval_channel;
mod platform;
mod server;
mod webdriver;

pub use error::{Error, Result};

/// Default port for the `WebDriver` HTTP server
pub const DEFAULT_PORT: u16 = 4445;

/// Environment variable name for configuring the port
pub const PORT_ENV_VAR: &str = "TAURI_WEBDRIVER_PORT";

/// Initializes the plugin with default settings.
///
/// The port is determined in the following order:
/// 1. `TAURI_WEBDRIVER_PORT` environment variable (if set and valid)
/// 2. Default port (4445)
#[must_use]
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    let port = std::env::var(PORT_ENV_VAR)
        .ok()
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(DEFAULT_PORT);

    init_with_port(port)
}

/// Initializes the plugin with a custom port.
///
/// This ignores the `TAURI_WEBDRIVER_PORT` environment variable.
#[must_use]
pub fn init_with_port<R: Runtime>(port: u16) -> TauriPlugin<R> {
    Builder::new("wdio-webdriver")
        .setup(move |app, api| {
            #[cfg(mobile)]
            let webdriver = mobile::init(app, api)?;
            #[cfg(desktop)]
            let webdriver = desktop::init(app, api);
            app.manage(webdriver);

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
        .on_webview_ready(|webview| {
            platform::register_webview_handlers(&webview);
        })
        .build()
}
