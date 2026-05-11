// Forked from tauri-driver 2.0.6 — native WebDriver subprocess setup.
//
// Diff vs. upstream:
//   - `TAURI_AUTOMATION` (legacy 1.x) env var dropped.
//   - `TAURI_WEBVIEW_AUTOMATION` → `DIOXUS_WEBVIEW_AUTOMATION`. The env var is
//     consumed by `wdio-dioxus-bridge`'s automation.rs inside the Dioxus app
//     binary (see packages/dioxus-bridge/src/automation.rs); on Windows it's
//     a no-op at the Wry level, but we set it anyway for forward compat with
//     the bridge crate.

use crate::cli::Args;
use std::{
  env::current_dir,
  process::{Command, Stdio},
};

// the name of the binary to find in $PATH
#[cfg(target_os = "linux")]
const DRIVER_BINARY: &str = "WebKitWebDriver";

#[cfg(target_os = "windows")]
const DRIVER_BINARY: &str = "msedgedriver.exe";

/// Find the native driver binary in the PATH, or exits the process with an error.
pub fn native(args: &Args) -> Command {
  let native_binary = match args.native_driver.as_deref() {
    Some(custom) => {
      if custom.exists() {
        custom.to_owned()
      } else {
        eprintln!(
          "can not find the supplied binary path {}. This is currently required.",
          custom.display()
        );
        match current_dir() {
          Ok(cwd) => eprintln!("current working directory: {}", cwd.display()),
          Err(error) => eprintln!("can not find current working directory: {error}"),
        }
        std::process::exit(1);
      }
    }
    None => match which::which(DRIVER_BINARY) {
      Ok(binary) => binary,
      Err(error) => {
        eprintln!(
          "can not find binary {DRIVER_BINARY} in the PATH. This is currently required. \
          You can also pass a custom path with --native-driver"
        );
        eprintln!("{error:?}");
        std::process::exit(1);
      }
    },
  };

  let mut cmd = Command::new(native_binary);
  cmd.env("DIOXUS_WEBVIEW_AUTOMATION", "true");
  cmd.arg(format!("--port={}", args.native_port));
  cmd.arg(format!("--host={}", args.native_host));

  // Don't inherit stdout from parent to prevent native WebDriver binary/HTTP protocol data
  // from corrupting wdio-dioxus-driver's stdout (which gets captured by the test framework).
  // Keep stderr inherited so WebDriver logs/errors are still visible.
  cmd.stdout(Stdio::null());

  cmd
}
