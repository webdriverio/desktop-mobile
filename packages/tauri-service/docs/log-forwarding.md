# Log Forwarding

Capture and forward logs from your Tauri application to WebDriverIO's logger system.

## Overview

The Tauri service can capture and forward logs from both the Rust backend and frontend console to WebDriverIO's logger system. This allows you to see Tauri application logs seamlessly integrated with your test output.

## Enabling Log Forwarding

Log forwarding is disabled by default. Enable it via service options:

```typescript
// wdio.conf.ts
export const config = {
  services: [
    [
      '@wdio/tauri-service',
      {
        // Enable backend log capture (Rust logs from stdout)
        captureBackendLogs: true,
        // Enable frontend log capture (console logs from webview)
        captureFrontendLogs: true,
        // Minimum log level for backend logs (default: 'info')
        backendLogLevel: 'info',
        // Minimum log level for frontend logs (default: 'info')
        frontendLogLevel: 'info',
      },
    ],
  ],
  capabilities: [
    {
      browserName: 'tauri',
      'tauri:options': {
        application: './path/to/app',
      },
    },
  ],
};
```

## Log Levels

Both backend and frontend log capture support the following log levels (in order of priority):
- `trace` - Most verbose
- `debug` - Debug information
- `info` - Informational messages (default)
- `warn` - Warning messages
- `error` - Error messages

Only logs at the configured level and above will be captured. For example, with `backendLogLevel: 'info'`, only `info`, `warn`, and `error` logs will be captured.

## Log Format

Captured logs are formatted with context tags:
- Backend logs: `[Tauri:Backend] message`
- Frontend logs: `[Tauri:Frontend] message`
- Multiremote logs: `[Tauri:Backend:instanceId] message` or `[Tauri:Frontend:instanceId] message`

## Backend Log Capture

Backend log capture reads Rust logs from the Tauri application's stdout. These logs are generated using Rust's `log` crate:

```rust
// In your Tauri app
log::info!("This is an info log");
log::warn!("This is a warning");
log::error!("This is an error");
```

The service automatically filters out tauri-driver logs and only captures logs from your Tauri application.

## Frontend Log Capture

Frontend log capture uses WebDriver's `getLogs` API to retrieve console logs from the webview:

```javascript
// In your Tauri app frontend
console.info('This is an info log');
console.warn('This is a warning');
console.error('This is an error');
```

Frontend logs are captured periodically (every second) and before each WebDriver command to ensure all logs are captured.

## Independent Configuration

Backend and frontend log capture can be configured independently:

```typescript
services: [
  ['@wdio/tauri-service', {
    // Only capture backend logs
    captureBackendLogs: true,
    captureFrontendLogs: false,
    backendLogLevel: 'debug', // Capture debug and above
  }],
],
```

## Multiremote Support

In multiremote scenarios, logs are captured per instance with instance IDs in the log context:

```typescript
capabilities: {
  browserA: {
    browserName: 'tauri',
    'tauri:options': {
      application: './path/to/app',
    },
  },
  browserB: {
    browserName: 'tauri',
    'tauri:options': {
      application: './path/to/app',
    },
  },
},

services: [
  ['@wdio/tauri-service', {
    captureBackendLogs: true,
    captureFrontendLogs: true,
  }],
],
```

Logs will appear as:
- `[Tauri:Backend:browserA] message`
- `[Tauri:Frontend:browserB] message`

## Performance Considerations

- Log capture is optional and disabled by default to avoid overhead
- Frontend log capture uses periodic polling (every 1 second) which has minimal performance impact
- Backend log parsing is efficient and non-blocking
- Log level filtering reduces the number of logs processed

## Troubleshooting

### Logs not appearing

- Ensure `captureBackendLogs` or `captureFrontendLogs` is set to `true`
- Check that your log level is appropriate (logs below the configured level won't appear)
- Verify logs are being written to stdout (backend) or console (frontend)

### Too many logs

- Increase the log level (e.g., from `debug` to `info`) to filter out verbose logs
- Disable log capture for one source if you only need backend or frontend logs

### Frontend logs not captured

- Some WebDriver implementations may not support `getLogs` API
- The service will silently fail if `getLogs` is not supported
- Backend logs will still work in this case

## See Also

- [Configuration](./configuration.md) for all service options
- [Usage Examples](./usage-examples.md) for logging patterns
- [Troubleshooting](./troubleshooting.md) for common issues
