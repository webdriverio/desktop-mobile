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

## Where Logs Go

The service reads the app's stdout and stderr: from the app itself with the `embedded` provider, and through tauri-driver or CrabNebula's backend with the others. It writes each captured line to a log file, `wdio-<timestamp>.log`:

- With the test runner, in WebdriverIO's `outputDir`, or `logs/` in the working directory if that isn't set.
- In standalone mode, in [`logDir`](./configuration.md#logdir-string-optional), or `logs/` in the working directory.

If the file can't be opened, the lines go to WebdriverIO's logger as `tauri-service` instead.

## Log Format

Each line starts with its source, `[Tauri:Backend]` or `[Tauri:Frontend]`, and the instance it came from:

- In multiremote, the instance's name: `[Tauri:Backend:browserA]`.
- Otherwise, with the `embedded` provider, the capability's index: `[Tauri:Backend:0]`.
- With a tauri-driver per worker, the worker's ID.
- A tauri-driver shared by every capability adds no instance: `[Tauri:Backend]`.

## Backend Log Capture

Every line the app writes to stdout or stderr counts as a backend log unless it's a frontend log (see below). For example, from Rust's `log` crate:

```rust
// In your Tauri app
log::info!("This is an info log");
log::warn!("This is a warning");
log::error!("This is an error");
```

The level is read from the start of the line, where Rust's `log` and `tracing` put it. A line without one counts as `info`.

Lines from tauri-driver and the native driver aren't app logs. The service drops them from capture and logs them at the service's `logLevel` instead.

## Frontend Log Capture

The frontend plugin, `@wdio/tauri-plugin`, wraps `console.log`, `console.debug`, `console.info`, `console.warn`, `console.error` and `console.trace` when your frontend imports it. Each call still reaches the console, and is also sent to `tauri-plugin-wdio`'s `log_frontend` command, which prints it to the app's stderr as `[WDIO-FRONTEND][LEVEL] message`. The service reads those lines as frontend logs.

```javascript
// In your Tauri app frontend
console.info('This is an info log');
console.warn('This is a warning');
console.error('This is an error');
```

`console.log` and `console.trace` are `trace` level, so the default `frontendLogLevel`, `'info'`, drops them. Set `frontendLogLevel: 'trace'` to capture them.

If the app has `tauri-plugin-log`'s JavaScript API (`window.__TAURI__.log`), the frontend plugin logs through it instead of `log_frontend`. The service sees those logs only if `tauri-plugin-log` writes to stdout or stderr, and counts a line as a frontend log only if it contains `[frontend]`.

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
    capabilities: {
      browserName: 'tauri',
      'tauri:options': {
        application: './path/to/app',
      },
    },
  },
  browserB: {
    capabilities: {
      browserName: 'tauri',
      'tauri:options': {
        application: './path/to/app',
      },
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

- Log capture is off by default.
- Every frontend console call makes an IPC call to the app, whether or not capture is on.
- Log level filtering reduces the number of lines written.

## Troubleshooting

### Logs not appearing

- Ensure `captureBackendLogs` or `captureFrontendLogs` is set to `true`
- Check that your log level is appropriate (logs below the configured level won't appear)
- Look in the log file, not the terminal (see [Where Logs Go](#where-logs-go))

### Too many logs

- Increase the log level (e.g., from `debug` to `info`) to filter out verbose logs
- Disable log capture for one source if you only need backend or frontend logs

### Frontend logs not captured

- Check that the frontend imports `@wdio/tauri-plugin` and the app registers `tauri-plugin-wdio` with the `wdio:default` permission.
- Check the level: `console.log` is `trace`, below the default `frontendLogLevel`.
- In browser mode there's no app process, so nothing is captured.

## See Also

- [Configuration](./configuration.md) for all service options
- [Usage Examples](./usage-examples.md) for logging patterns
- [Troubleshooting](./troubleshooting.md) for common issues
