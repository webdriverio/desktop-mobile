# Debugging

This guide covers the debugging tools and features available in the Electron service to help you gain visibility into your application's behavior during tests.

For configuration reference, see [Service Configuration](./configuration.md). For troubleshooting specific errors, see [Common Issues](./common-issues.md).

## Debug Logging

If you need extra insight into what the service is doing you can enable namespaced debug logging via the `DEBUG` environment variable.
- `DEBUG=wdio-electron-service` is equivalent to `DEBUG=wdio-electron-service:*` (enable all service namespaces)
- You can target specific areas, e.g. `DEBUG=wdio-electron-service:service,mock`

> **Migrating from v9?** The debug namespace **did not change** with the v10 package rename. Continue to use `wdio-electron-service:*` rather than `@wdio/electron-service:*` — the colon separator inside the namespace is what `debug` parses, so the unscoped form is preserved deliberately.

Examples:

```bash
# enable all service logs
DEBUG=wdio-electron-service:* wdio run ./wdio.conf.ts

# enable only core service + mocks
DEBUG=wdio-electron-service:service,mock wdio run ./wdio.conf.ts
```

Logs are also forwarded into WDIO runner logs under your configured `outputDir`.

This is utilising the [`debug`](https://github.com/debug-js/debug) logging package.

## Electron Log Capture

The service can capture console output from both Electron's main process and renderer processes.

### Enabling Log Capture

```ts
export const config = {
  services: [
    [
      'electron',
      {
        captureMainProcessLogs: true,
        captureRendererLogs: true,
        mainProcessLogLevel: 'info',
        rendererLogLevel: 'info',
      },
    ],
  ],
};
```

Logs will appear in your WDIO test output with appropriate prefixes:

```
[Electron:MainProcess] Database connection established
[Electron:Renderer] Component mounted successfully
[Electron:MainProcess] IPC message received: user-action
```

### Log Levels

Filter logs by setting minimum levels. Log priority (lowest to highest):

```
trace < debug < info < warn < error
```

Examples:

```ts
// Capture only warnings and errors from main process
mainProcessLogLevel: 'warn';

// Capture debug and above from renderer (excludes trace)
rendererLogLevel: 'debug';

// Capture everything from main process
mainProcessLogLevel: 'trace';
```

### Debugging with Logs

**Scenario 1: IPC Communication Issues**

Enable main process logs to see IPC handler execution:

```ts
// In main process
ipcMain.handle('user-action', async (event, data) => {
  console.log('[IPC] Received user-action:', data);
  const result = await processAction(data);
  console.log('[IPC] Sending response:', result);
  return result;
});
```

Test output:

```
[Electron:MainProcess] [IPC] Received user-action: { type: 'save' }
[Electron:MainProcess] [IPC] Sending response: { success: true }
```

**Scenario 2: Renderer Lifecycle Issues**

Enable renderer logs to debug component initialization:

```ts
// In renderer
console.log('[Lifecycle] App component mounting');
console.log('[Lifecycle] Loading user data');
console.log('[Lifecycle] Render complete');
```

**Scenario 3: Crash Investigation**

Set log level to `debug` or `trace` to capture detailed diagnostic information:

```ts
export const config = {
  services: [
    [
      'electron',
      {
        captureMainProcessLogs: true,
        mainProcessLogLevel: 'debug', // Capture detailed logs
        captureRendererLogs: true,
        rendererLogLevel: 'debug',
      },
    ],
  ],
};
```

### Log Capture Requirements

**Main Process Logs:**
- Require the `EnableNodeCliInspectArguments` Electron fuse to be enabled
- Require CDP bridge connection to main process
- If the CDP bridge is unavailable:
  - ⚠️ Main process log capture will be disabled with a warning
  - ⚠️ Warning visible with `DEBUG=wdio-electron-service:*`
  - ✅ Tests continue normally - no failures
  - See [Common Issues - CDP bridge initialization](./common-issues.md#cdp-bridge-cannot-be-initialized-enablenodecliinspectarguments-fuse-is-disabled) for troubleshooting

**Renderer Process Logs:**
- Use Puppeteer CDP sessions - work independently of main process CDP bridge
- Do NOT require the `EnableNodeCliInspectArguments` fuse
- Will continue to work even if main process CDP bridge is unavailable
- Useful for debugging when the fuse is disabled

### Standalone Mode Logging

When using `startWdioSession()` without the WDIO test runner, logs are written to files instead of being forwarded to WDIO's logger:

```ts
const browser = await startWdioSession([
  {
    browserName: 'electron',
    'wdio:electronServiceOptions': {
      appBinaryPath: '/path/to/binary',
      captureMainProcessLogs: true,
      logDir: './test-logs', // Required for standalone mode
    },
  },
]);
```

See [Standalone Mode documentation](./standalone-mode.md#log-capture-in-standalone-mode) for details.
