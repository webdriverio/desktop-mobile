// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{PhysicalPosition, PhysicalSize, Window};
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
    // For now, return a placeholder base64 string
    // In a real implementation, you would use a screenshot library
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

// Test functions removed - skipping parameter tests for now


#[tauri::command]
async fn get_platform_info() -> Result<PlatformInfo, String> {
    let mut sys = System::new_all();
    sys.refresh_all();

    let total_memory = sys.total_memory();
    let free_memory = sys.free_memory();

    // Simplified disk info - just return placeholder values for now
    let total_disk = 1000000000u64; // 1GB placeholder
    let free_disk = 500000000u64;   // 500MB placeholder

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

fn main() {
    let use_embedded_server = std::env::var("WDIO_EMBEDDED_SERVER").is_ok();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_wdio::init())
        .plugin(tauri_plugin_fs::init());

    if use_embedded_server {
        builder = builder.plugin(tauri_plugin_wdio_webdriver::init());
    }

    builder.invoke_handler(tauri::generate_handler![
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
            write_clipboard
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application")
}
