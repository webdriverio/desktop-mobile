use std::sync::Mutex;
use tauri::{
    plugin::{self, TauriPlugin},
    Manager, Runtime,
};

pub use models::*;

mod desktop;
mod commands;
mod error;
mod models;

pub use error::{Error, Result};

use desktop::Wdio;

struct WdioUnifiedLogger;

static LOGGER_INIT: Mutex<bool> = Mutex::new(false);

impl log::Log for WdioUnifiedLogger {
    fn enabled(&self, _metadata: &log::Metadata) -> bool {
        true
    }

    fn log(&self, record: &log::Record) {
        eprintln!("[Tauri:Backend] {}: {}", record.level(), record.args());
    }

    fn flush(&self) {}
}

/// Creates the Wdio plugin with default options.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    plugin::Builder::new("wdio")
        .invoke_handler(tauri::generate_handler![
            commands::execute,
            commands::log_frontend,
            commands::debug_plugin,
            commands::get_active_window_label,
            commands::list_windows,
            commands::get_window_states
        ])
        .setup(|app_handle, _api| {
            // Only set up our global logger if no logger is already configured
            // This prevents conflicts with tauri_plugin_log or other loggers
            let mut initialized = LOGGER_INIT.lock().unwrap();
            if !*initialized {
                let logger = Box::new(WdioUnifiedLogger);
                if let Err(e) = log::set_boxed_logger(logger) {
                    eprintln!("[WDIO] Failed to set global logger (may be already set by another plugin): {}", e);
                } else {
                    *initialized = true;
                }
            }
            drop(initialized);

            let wdio = desktop::init(app_handle, _api)?;

            app_handle.manage(wdio);

            Ok(())
        })
        .build()
}

/// Extension trait for accessing wdio APIs
pub trait WdioExt<R: Runtime> {
    fn wdio(&self) -> &Wdio<R>;
}

impl<R: Runtime, T: Manager<R>> WdioExt<R> for T {
    fn wdio(&self) -> &Wdio<R> {
        self.state::<Wdio<R>>().inner()
    }
}
