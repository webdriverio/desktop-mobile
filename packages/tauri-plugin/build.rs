// WebDriverIO Tauri Plugin Build Configuration
//
// This plugin provides execute and mocking capabilities for WebDriverIO testing.
//
// IMPORTANT: ACL Permissions Setup
// ================================
// This plugin uses tauri_plugin::Builder (not tauri_build::InlinedPlugin) because:
//
// 1. InlinedPlugin does not automatically generate ACL permissions for plugins
// 2. The permissions must be explicitly defined in permissions/default.toml
// 3. Using tauri_plugin::Builder properly integrates the permissions system
// 4. This ensures permissions appear in the generated ACL manifest (gen/schemas/acl-manifests.json)
//
// The COMMANDS list below must stay in sync with the invoke_handler in src/lib.rs.
// Apps using this plugin should reference the bundled `wdio:default` permission.
//
// For more details on Tauri v2 plugin permissions, see:
// https://v2.tauri.app/develop/plugins/develop/#permissions

const COMMANDS: &[&str] = &[
    "execute",
    "log_frontend",
    "debug_plugin",
    "get_active_window_label",
    "get_window_states",
    "list_windows",
];


fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}
