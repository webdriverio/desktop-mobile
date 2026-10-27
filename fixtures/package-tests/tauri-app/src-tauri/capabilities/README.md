# Tauri Capabilities Configuration

This directory contains capability files that define the ACL (Access Control List) permissions for the application.

## WebDriverIO Plugin Permissions

The `@wdio/tauri-plugin` exposes the following permissions:
- `wdio:allow-execute` - Allows executing JavaScript in the frontend with access to Tauri APIs
- `wdio:allow-emit-deep-link` - Allows `triggerDeeplink()` to emit a deep link in the app
- `wdio:allow-log-frontend` - Allows the plugin to forward frontend logs through Rust's logger
- `wdio:allow-debug-plugin` - Diagnostic helper command for plugin state
- `wdio:allow-get-active-window-label` - Read the currently active webview window label
- `wdio:allow-get-window-states` - Read window state metadata
- `wdio:allow-list-windows` - List all webview window labels

The bundled `wdio:default` permission grants all of the above. Mocking is handled entirely on the JavaScript side via invoke interception, so no mock-related Rust permissions are required.

## For More Information

- [Tauri v2 Security & Capabilities](https://v2.tauri.app/security/capabilities/)
- [Plugin Permissions Documentation](../../../../../packages/tauri-plugin/permissions/default.toml)
