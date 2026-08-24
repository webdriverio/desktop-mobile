// Prevents additional console window on Windows in release, DO NOT REMOVE!!
// NOTE: This also detaches stdout/stderr in release mode on Windows, preventing log capture.
// E2E tests use debug builds on Windows to preserve stdout/stderr for logging tests.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use once_cell::sync::Lazy;

static DEEP_LINKS: Lazy<Mutex<Vec<String>>> = Lazy::new(|| Mutex::new(Vec::new()));

fn collect_deep_links_from_args() -> Vec<String> {
    let mut deep_links = Vec::new();
    for arg in std::env::args().skip(1) {
        if arg.starts_with("testapp://") {
            deep_links.push(arg.clone());
        }
    }
    deep_links
}

use tauri::{PhysicalPosition, PhysicalSize, Window, Emitter, Manager};
use serde::{Serialize, Deserialize};
use sysinfo::System;
use clipboard::{ClipboardProvider, ClipboardContext};

#[derive(Debug, Serialize, Deserialize)]
struct WindowBounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Debug, Serialize, Deserialize)]
struct ScreenshotOptions {
    format: Option<String>,
    quality: Option<u8>,
    path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct FileOperationOptions {
    encoding: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct PlatformInfo {
    os: String,
    arch: String,
    version: String,
    hostname: String,
    memory: MemoryInfo,
    cpu: CpuInfo,
    disk: DiskInfo,
}

#[derive(Debug, Serialize, Deserialize)]
struct MemoryInfo {
    total: u64,
    free: u64,
}

#[derive(Debug, Serialize, Deserialize)]
struct CpuInfo {
    cores: usize,
    frequency: u64,
}

#[derive(Debug, Serialize, Deserialize)]
struct DiskInfo {
    total: u64,
    free: u64,
}

// Basic Tauri Commands for testing
#[tauri::command]
async fn get_window_bounds(window: Window) -> Result<WindowBounds, String> {
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    Ok(WindowBounds {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}

#[tauri::command]
async fn set_window_bounds(window: Window, bounds: WindowBounds) -> Result<(), String> {
    window.set_position(PhysicalPosition::new(bounds.x, bounds.y)).map_err(|e| e.to_string())?;
    window.set_size(PhysicalSize::new(bounds.width, bounds.height)).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn minimize_window(window: Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn maximize_window(window: Window) -> Result<(), String> {
    window.maximize().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn unmaximize_window(window: Window) -> Result<(), String> {
    window.unmaximize().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn close_window(window: Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn take_screenshot(_options: Option<ScreenshotOptions>) -> Result<String, String> {
    Ok("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==".to_string())
}

#[tauri::command]
async fn read_file(path: String, _options: Option<FileOperationOptions>) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read file '{}': {}", path, e))
}

#[tauri::command]
async fn write_file(path: String, contents: String, _options: Option<FileOperationOptions>) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("Failed to write file '{}': {}", path, e))?;
    Ok(())
}

#[tauri::command]
async fn delete_file(path: String) -> Result<(), String> {
    std::fs::remove_file(&path).map_err(|e| format!("Failed to delete file '{}': {}", path, e))?;
    Ok(())
}

#[tauri::command]
async fn get_current_dir() -> Result<String, String> {
    std::env::current_dir()
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_platform_info() -> Result<PlatformInfo, String> {
    let mut sys = System::new_all();
    sys.refresh_all();

    let total_memory = sys.total_memory();
    let free_memory = sys.free_memory();

    let total_disk = 1000000000u64;
    let free_disk = 500000000u64;

    Ok(PlatformInfo {
        os: System::name().unwrap_or_else(|| "Unknown".to_string()),
        arch: std::env::consts::ARCH.to_string(),
        version: System::os_version().unwrap_or_else(|| "Unknown".to_string()),
        hostname: System::host_name().unwrap_or_else(|| "Unknown".to_string()),
        memory: MemoryInfo {
            total: total_memory,
            free: free_memory,
        },
        cpu: CpuInfo {
            cores: sys.cpus().len(),
            frequency: sys.cpus().first().map(|c| c.frequency()).unwrap_or(0),
        },
        disk: DiskInfo {
            total: total_disk,
            free: free_disk,
        },
    })
}

#[tauri::command]
async fn read_clipboard() -> Result<String, String> {
    let mut ctx = ClipboardContext::new().map_err(|e| e.to_string())?;
    ctx.get_contents().map_err(|e| e.to_string())
}

#[tauri::command]
async fn write_clipboard(content: String) -> Result<(), String> {
    let mut ctx = ClipboardContext::new().map_err(|e| e.to_string())?;
    ctx.set_contents(content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn generate_test_logs(app: tauri::AppHandle) -> Result<(), String> {
    let logs = [
        ("TRACE", "This is a TRACE level log"),
        ("DEBUG", "This is a DEBUG level log"),
        ("INFO", "This is an INFO level log"),
        ("WARN", "This is a WARN level log"),
        ("ERROR", "This is an ERROR level log"),
    ];

    for (level, message) in logs {
        let _ = app.emit("backend-log", &format!("[{}] {}", level, message));
        eprintln!("[{}] {}", level, message);
        // Under CrabNebula on macOS the app is a .app bundle with detached stderr, so the
        // eprintln! above never reaches the test; the webview event is the path that does.
        let _ = app.emit(
            "wdio-log",
            serde_json::json!({ "source": "backend", "level": level.to_lowercase(), "message": message }),
        );
    }

    Ok(())
}

#[tauri::command]
async fn get_deep_links(_app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let links = DEEP_LINKS.lock().map_err(|e| e.to_string())?.clone();
    Ok(links)
}

#[tauri::command]
async fn get_command_line_args() -> Result<Vec<String>, String> {
    Ok(std::env::args().collect())
}

fn emit_deep_links<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let deep_links = DEEP_LINKS.lock().map(|guard| guard.clone()).unwrap_or_default();

    if !deep_links.is_empty() {
        for link in &deep_links {
            let _ = app.emit("deeplink-received", link);
        }
    }
}

fn create_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> tauri::WebviewWindow<R> {
    if let Some(existing) = app.get_webview_window("main") {
        return existing;
    }
    let window = tauri::WebviewWindowBuilder::new(
        app,
        "main",
        tauri::WebviewUrl::App("index.html".into())
    )
    .title("Tauri E2E Test App")
    .inner_size(600.0, 400.0)
    .build()
    .expect("Failed to create main window");
    window
}

#[tauri::command]
async fn switch_to_main(app: tauri::AppHandle) -> Result<(), String> {
    let main = app.get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    // Hide splash (keeps WebDriver session alive)
    if let Some(splash) = app.get_webview_window("splash") {
        splash.hide().map_err(|e| e.to_string())?;
    }

    // Show and focus main
    main.show().map_err(|e| e.to_string())?;
    main.set_focus().map_err(|e| e.to_string())?;

    Ok(())
}

fn main() {
    let is_splash = std::env::var("ENABLE_SPLASH_WINDOW").is_ok();

    // Enable single-instance plugin when explicitly requested (deeplink tests via WDIO env)
    // OR when launched as a protocol handler (args contain testapp:// URL).
    // The latter case handles Windows protocol-handler launches where cmd /c "set ..."
    // env var propagation is unreliable — detecting the URL in args is more robust.
    let has_deeplink_arg = std::env::args().any(|a| a.starts_with("testapp://"));
    let enable_single_instance = std::env::var("ENABLE_SINGLE_INSTANCE").is_ok() || has_deeplink_arg;

    // Only load embedded WebDriver server for embedded driver provider
    // CrabNebula uses tauri-driver + test-runner-backend instead
    let use_embedded_server = std::env::var("WDIO_EMBEDDED_SERVER").is_ok();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_wdio::init());

    // Conditionally load embedded WebDriver server
    if use_embedded_server {
        builder = builder.plugin(tauri_plugin_wdio_webdriver::init());
    }

    // Add automation plugin for macOS CrabNebula testing (debug builds only)
    #[cfg(all(debug_assertions, target_os = "macos"))]
    {
        builder = builder.plugin(tauri_plugin_automation::init());
    }

    // Add single-instance plugin only when explicitly enabled (deeplink tests)
    if enable_single_instance {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // Forward deep links from second instance to the running instance
            for arg in args.iter() {
                if arg.starts_with("testapp://") {
                    if let Ok(mut links) = DEEP_LINKS.lock() {
                        links.push(arg.clone());
                    }
                    let _ = app.emit("deeplink-received", arg);
                }
            }
        }));
    }

    builder
        .plugin(tauri_plugin_deep_link::init())
        .setup(move |app| {
            // Collect deep links from CLI args at startup
            let cli_deep_links = collect_deep_links_from_args();
            if !cli_deep_links.is_empty() {
                let mut deep_links_guard = DEEP_LINKS.lock().unwrap();
                for link in &cli_deep_links {
                    deep_links_guard.push(link.clone());
                }
                drop(deep_links_guard);
                emit_deep_links(&app.handle());
            }

            // Register deeplink protocol at runtime (Linux/Windows only)
            // This is needed for development/testing when the protocol handler
            // hasn't been registered by the installer
            #[cfg(any(target_os = "linux", target_os = "windows"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;

                match app.deep_link().register("testapp") {
                    Ok(_) => {}
                    Err(_e) => {
                        eprintln!("[Tauri] Protocol registration note: {}. Deep links still work via CLI args.", _e);
                    }
                }
            }

            if is_splash {
                // 1. SPLASH FIRST - WebDriver MUST connect here (visible + focused)
                let splash = tauri::WebviewWindowBuilder::new(
                    app,
                    "splash",
                    tauri::WebviewUrl::App("splash.html".into())
                )
                .title("Splash Screen")
                .inner_size(300.0, 200.0)
                .resizable(false)
                .decorations(false)
                .focused(true)
                .build()
                .expect("Failed to create splash window");

                splash.show().expect("Failed to show splash");
                splash.set_focus().expect("Failed to focus splash");

                // 2. MAIN SECOND - hidden until switch_to_main
                let _main = tauri::WebviewWindowBuilder::new(
                    app,
                    "main",
                    tauri::WebviewUrl::App("index.html".into())
                )
                .title("Tauri E2E Test App")
                .inner_size(600.0, 400.0)
                .visible(false)
                .build()
                .expect("Failed to create main window");
            } else {
                create_main_window(app.handle());
            }
            Ok::<(), Box<dyn std::error::Error>>(())
        })
        .invoke_handler(tauri::generate_handler![
            get_window_bounds,
            set_window_bounds,
            minimize_window,
            maximize_window,
            unmaximize_window,
            close_window,
            take_screenshot,
            read_file,
            write_file,
            delete_file,
            get_current_dir,
            get_platform_info,
            read_clipboard,
            write_clipboard,
            generate_test_logs,
            switch_to_main,
            get_deep_links,
            get_command_line_args,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
