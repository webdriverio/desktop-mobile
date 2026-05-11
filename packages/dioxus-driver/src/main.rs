// Forked from tauri-driver 2.0.6 (Tauri Programme within The Commons Conservancy,
// Apache-2.0 OR MIT). Diff vs. upstream is intentionally minimal — see
// README.md for the upstream-sync policy.

//! Cross-platform WebDriver server for Dioxus desktop applications.
//!
//! This is a [WebDriver Intermediary Node](https://www.w3.org/TR/webdriver/#dfn-intermediary-nodes)
//! that wraps the native WebDriver server (msedgedriver on Windows,
//! WebKitWebDriver on Linux) for platforms that Dioxus's Wry backend supports.
//! Your WebDriver client connects to the running `wdio-dioxus-driver` server,
//! and the driver handles starting the native WebDriver server for you behind
//! the scenes. It requires two separate ports since two distinct
//! [WebDriver Remote Ends](https://www.w3.org/TR/webdriver/#dfn-remote-ends) run.
//!
//! v1 supports Windows only (matching the spike findings in
//! `spike/FINDINGS.md` — Linux requires an upstream Dioxus PR exposing Wry's
//! automation toggle).

#[cfg(any(target_os = "linux", windows))]
mod cli;
#[cfg(any(target_os = "linux", windows))]
mod server;
#[cfg(any(target_os = "linux", windows))]
mod webdriver;

#[cfg(not(any(target_os = "linux", windows)))]
fn main() {
  println!("wdio-dioxus-driver is not supported on this platform");
  std::process::exit(1);
}

#[cfg(any(target_os = "linux", windows))]
fn main() {
  let args = pico_args::Arguments::from_env().into();

  #[cfg(windows)]
  let _job_handle = {
    let job = win32job::Job::create().unwrap();
    let mut info = job.query_extended_limit_info().unwrap();
    info.limit_kill_on_job_close();
    job.set_extended_limit_info(&info).unwrap();
    job.assign_current_process().unwrap();
    job
  };

  // start the native webdriver on the port specified in args
  let mut driver = webdriver::native(&args);
  let driver = driver
    .spawn()
    .expect("error while running native webdriver");

  // start our webdriver intermediary node
  if let Err(e) = server::run(args, driver) {
    eprintln!("error while running server: {e}");
    std::process::exit(1);
  }
}
