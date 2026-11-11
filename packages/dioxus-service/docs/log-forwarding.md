# Log Forwarding

Capture your Dioxus app's backend and frontend logs during a test run.

## Overview

The service starts your app, so it reads everything the app writes to stdout and stderr. Frontend logs reach it the same way: the bridge that `wdio_dioxus::install(config)` adds wraps the webview's `console.*` methods and has the app print each call to stdout with a `[WDIO-FRONTEND]` marker. The service sorts each line into backend or frontend, filters it by level, and writes it to a log file.

Captured lines go to a `wdio-<timestamp>.log` file in WebdriverIO's `outputDir`, or in `logs/` in the working directory when `outputDir` isn't set.

## Enabling Log Forwarding

Log forwarding is disabled by default. Enable it via service options:

```typescript
// wdio.conf.ts
export const config = {
  services: [
    [
      '@wdio/dioxus-service',
      {
        captureBackendLogs: true, // Capture Rust logs from the app process
        captureFrontendLogs: true, // Capture console logs from the webview
        backendLogLevel: 'info', // Minimum backend log level (default: 'info')
        frontendLogLevel: 'info', // Minimum frontend log level (default: 'info')
      },
    ],
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

Each line is prefixed with its source and the instance it came from:

- Backend logs: `[Dioxus:Backend:<instance>] message`
- Frontend logs: `[Dioxus:Frontend:<instance>] message`

`<instance>` is the capability's index, so a single session's lines start with `[Dioxus:Backend:0]` and `[Dioxus:Frontend:0]`. In multiremote, it's the instance's name, such as `browserA`.

## Backend Log Capture

Every line the app writes to stdout or stderr that doesn't start with `[WDIO-FRONTEND]` is a backend log. That includes Rust logs, `println!` output, and the logs of crates the app uses, such as the embedded driver's own. Nothing filters them by origin; only the log level does.

The service takes a line's level from the first `TRACE`, `DEBUG`, `INFO`, `WARN` (or `WARNING`) or `ERROR` token in it, in any case. A line without one is `info`.

For example, with the Rust `log` crate:

```rust
// In your Dioxus app (add log crate to Cargo.toml)
log::info!("This is an info log");
log::warn!("This is a warning");
log::error!("This is an error");
```

Enable the `log` crate in your `Cargo.toml`:

```toml
[dependencies]
dioxus = { version = "0.7", features = ["desktop"] } # your Dioxus version (the bridge tracks the latest release)
log = "0.4"
```

> **Note:** The `log` crate prints nothing until the app installs a logger. Neither the bridge nor the service installs one, so add a logger that writes to stdout or stderr, such as `tracing-subscriber` or `env_logger`. Its filter decides which records reach the service at all.

## Frontend Log Capture

The bridge wraps `console.log`, `console.info`, `console.warn`, `console.error` and `console.debug` in the webview. Each call still reaches the original method, and is also sent to the app, which prints it to stdout as `[WDIO-FRONTEND][<LEVEL>] message`. The service strips that marker and logs the message as a frontend log.

```javascript
// In your Dioxus frontend (JavaScript/TypeScript)
console.info('This is an info log');
console.warn('This is a warning');
console.error('This is an error');
```

`console.log` and `console.info` are `info`; `console.warn`, `console.error` and `console.debug` keep their own level. Other console methods, such as `console.trace`, aren't forwarded. Arguments are joined with spaces, and non-string arguments are converted with `JSON.stringify`.

Frontend capture needs the bridge, and only sees calls made after it loads.

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

In multiremote, each instance's lines carry the instance's name:

```typescript
capabilities: {
  browserA: {
    capabilities: {
      browserName: 'dioxus',
      'dioxus:options': {
        application: './target/debug/my_app',
      },
    },
  },
  browserB: {
    capabilities: {
      browserName: 'dioxus',
      'dioxus:options': {
        application: './target/debug/my_app',
      },
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

- Log capture is disabled by default.
- With `captureFrontendLogs` off, the bridge still forwards each console call to the app, which prints it; the service drops the line.
- A noisy app logger fills the log file. Raise the level in the app's logger, or `backendLogLevel`, to cut it down.

## Troubleshooting

### Logs not appearing

- Ensure `captureBackendLogs` or `captureFrontendLogs` is set to `true`.
- Check that your log level is appropriate (logs below the configured level won't appear).
- Check that the app writes backend logs to stdout or stderr, and that its logger's filter lets them through.
- Look in the log file, not the terminal: captured lines go to `outputDir`, or `logs/` in the working directory.

### Too many logs

- Increase the log level (e.g., from `debug` to `info`) to filter out verbose logs.
- Disable log capture for one source if you only need backend or frontend logs.

### Frontend logs not captured

- Check that the app calls `wdio_dioxus::install(config)`. Without the bridge, console calls aren't forwarded.
- Calls made before the bridge loads aren't captured.
- Only `console.log`, `info`, `warn`, `error` and `debug` are forwarded.

## See Also

- [Configuration](./configuration.md) for all service options
- [Usage Examples](./usage-examples.md) for logging patterns
- [Troubleshooting](./troubleshooting.md) for common issues
