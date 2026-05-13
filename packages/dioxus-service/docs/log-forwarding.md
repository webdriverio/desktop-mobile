# Log Forwarding

Capture and forward logs from your Dioxus application to WebdriverIO's logger system.

## Overview

The Dioxus service can capture and forward logs from both the Rust backend and the frontend webview console to WebdriverIO's logger system. This allows you to see Dioxus application logs seamlessly integrated with your test output.

## Enabling Log Forwarding

Log forwarding is disabled by default. Enable it via service options:

```typescript
// wdio.conf.ts
export const config = {
  services: [
    ['@wdio/dioxus-service', {
      captureBackendLogs: true,      // Capture Rust logs from the app process
      captureFrontendLogs: true,     // Capture console logs from the webview
      backendLogLevel: 'info',       // Minimum backend log level (default: 'info')
      frontendLogLevel: 'info',      // Minimum frontend log level (default: 'info')
    }],
  ],
  capabilities: [
    {
      browserName: 'dioxus',
      'dioxus:options': {
        application: './target/debug/my_app',
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

Only logs at the configured level and above will be captured. For example, with `backendLogLevel: 'info'`, only `info`, `warn`, and `error` logs are captured.

## Log Format

Captured logs are formatted with context tags:

- Backend logs: `[Dioxus:Backend] message`
- Frontend logs: `[Dioxus:Frontend] message`
- Multiremote logs: `[Dioxus:Backend:instanceId] message` / `[Dioxus:Frontend:instanceId] message`

## Backend Log Capture

Backend log capture reads Rust logs from the Dioxus application process. These logs are generated using the Rust `log` crate:

```rust
// In your Dioxus app (add log crate to Cargo.toml)
log::info!("This is an info log");
log::warn!("This is a warning");
log::error!("This is an error");
```

Enable the `log` crate in your `Cargo.toml`:

```toml
[dependencies]
dioxus = { version = "0.6", features = ["desktop"] }
log = "0.4"
```

The service automatically filters driver-level logs and only captures logs from your Dioxus application.

## Frontend Log Capture

Frontend log capture uses the WebDriver `getLogs` API to retrieve console logs from the webview:

```javascript
// In your Dioxus frontend (JavaScript/TypeScript)
console.info('This is an info log');
console.warn('This is a warning');
console.error('This is an error');
```

Frontend logs are captured periodically and before each WebDriver command.

## Independent Configuration

Backend and frontend log capture can be configured independently:

```typescript
services: [
  ['@wdio/dioxus-service', {
    captureBackendLogs: true,
    captureFrontendLogs: false,
    backendLogLevel: 'debug',
  }],
],
```

## Multiremote Support

In multiremote scenarios, logs are captured per instance with instance IDs in the log context:

```typescript
capabilities: {
  browserA: {
    browserName: 'dioxus',
    'dioxus:options': {
      application: './target/debug/my_app',
    },
  },
  browserB: {
    browserName: 'dioxus',
    'dioxus:options': {
      application: './target/debug/my_app',
    },
  },
},

services: [
  ['@wdio/dioxus-service', {
    captureBackendLogs: true,
    captureFrontendLogs: true,
  }],
],
```

Logs will appear as:
- `[Dioxus:Backend:browserA] message`
- `[Dioxus:Frontend:browserB] message`

## Performance Considerations

- Log capture is optional and disabled by default to avoid overhead.
- Frontend log capture uses periodic polling (every 1 second) which has minimal performance impact.
- Backend log parsing is efficient and non-blocking.
- Log level filtering reduces the number of logs processed.

## Troubleshooting

### Logs not appearing

- Ensure `captureBackendLogs` or `captureFrontendLogs` is set to `true`.
- Check that your log level is appropriate (logs below the configured level won't appear).
- Verify logs are being written to stdout (backend) or console (frontend).
- For backend logs: ensure the `log` crate is properly initialized in your Rust app.

### Too many logs

- Increase the log level (e.g., from `debug` to `info`) to filter out verbose logs.
- Disable log capture for one source if you only need backend or frontend logs.

### Frontend logs not captured

- Some WebDriver implementations may not support the `getLogs` API.
- The service will silently fail if `getLogs` is not supported.
- Backend logs will still work in this case.

## See Also

- [Configuration](./configuration.md) for all service options
- [Usage Examples](./usage-examples.md) for logging patterns
- [Troubleshooting](./troubleshooting.md) for common issues
