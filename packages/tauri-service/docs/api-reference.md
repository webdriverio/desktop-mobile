# API Reference

Complete API reference for @wdio/tauri-service.

## browser.tauri API

The following methods are available on the `browser.tauri` object when connected to a Tauri app.

### `browser.tauri.execute(script, ...args)`

Execute JavaScript code in the Tauri frontend context with access to Tauri APIs. Requires tauri-plugin-wdio to be installed and configured.

**Parameters:**
- `script` (Function | string) - JavaScript code to execute. If a function, receives Tauri APIs as the first parameter
- `...args` (any[]) - Additional arguments passed to the script

**Returns:** `Promise<ReturnValue>`

**Example:**
```typescript
// Execute with destructured Tauri APIs
const result = await browser.tauri.execute(({ core }) => {
  return core.invoke('get_platform_info');
});

// Execute with full Tauri APIs object
const version = await browser.tauri.execute(async (tauri) => {
  return tauri.app?.getVersion();
});

// Execute with arguments
const result = await browser.tauri.execute(
  (tauri, name) => tauri.core.invoke('greet', { name }),
  'World'
);

// Execute string of code
const result = await browser.tauri.execute('window.location.href');
```

**Note:** Requires tauri-plugin-wdio to be installed. See [Plugin Setup](./plugin-setup.md).

**Browser Mode:** Not available. `browser.tauri.execute()` requires a live Tauri backend and plugin bridge. Use `browser.execute()` for renderer-side code, or `browser.tauri.mock()` to intercept Tauri commands.

---

### `browser.tauri.emitEvent(event, payload?, target?)`

Emit a Tauri event to all listeners registered via `listen()` or `once()` in the frontend. The same call works in both native and browser mode — in native mode it routes through Tauri's real `event.emit()` / `event.emitTo()` via the plugin bridge; in browser mode it dispatches through the in-page listener registry installed by the IPC injection.

**Parameters:**
- `event` (string) - The event name to emit
- `payload?` (T) - Optional payload, JSON-serialized to listeners
- `target?` (string | TauriEventTarget) - Optional target filter — emits only to listeners whose `target` matches. Pass a window/webview label as a string, or a structured `TauriEventTarget` object.

**Returns:** `Promise<void>`

**Example:**
```typescript
// Frontend subscribes via @tauri-apps/api/event
import { listen } from '@tauri-apps/api/event';
const unlisten = await listen<{ rows: number }>('data-loaded', (e) => {
  document.querySelector('#count')!.textContent = String(e.payload.rows);
});

// Test emits the event — same line works in native and browser mode
await browser.tauri.emitEvent('data-loaded', { rows: 3 });
await expect($('#count')).toHaveText('3');

// Targeted emit — only listeners that subscribed with target 'main' receive it
await browser.tauri.emitEvent('focus-window', undefined, 'main');
```

**Browser Mode:** Routes through the in-page registry installed by the IPC injection. `listen()`, `once()`, and `unlisten()` work as expected. See the [Events section in the Browser Mode guide](./browser-mode.md#events) for details.

**See Also:**
- [Browser Mode Guide — Events](./browser-mode.md#events)

---

### `browser.tauri.mock(command)`

Mock a specific Tauri backend command. Returns a TauriMock object for configuring the mock behavior.

**Parameters:**
- `command` (string) - Name of the Tauri command to mock

**Returns:** `Promise<TauriMock>`

**Example:**
```typescript
const mock = await browser.tauri.mock('read_file');
await mock.mockReturnValue('mocked file content');

// Now calling invoke('read_file', ...) returns 'mocked file content'
const content = await browser.tauri.execute(({ core }) => core.invoke('read_file'));
expect(content).toBe('mocked file content');
```

**Browser Mode:** Works in browser mode — this is the primary testing API in browser mode. The `command` argument is the Tauri command name (matching what the frontend passes to `invoke()`). Trigger the command via a UI interaction or `browser.execute(() => window.__TAURI_INTERNALS__.invoke('command-name'))`, then call `update()` and assert.

```typescript
// Browser mode — mock a Tauri command
const mockReadFile = await browser.tauri.mock('read_file');
await mockReadFile.mockResolvedValue('mocked file content');

// Trigger the command (via UI or directly)
await browser.execute(() => window.__TAURI_INTERNALS__.invoke('read_file'));

// Sync call data and assert
await mockReadFile.update();
expect(mockReadFile).toHaveBeenCalledTimes(1);
```

See the [Browser Mode Guide](./browser-mode.md) for a full usage walkthrough.

**See Also:**
- [Browser Mode Guide](./browser-mode.md)

---

### `browser.tauri.isMockFunction(fn)`

Check if a value is a Tauri mock function. This is a TypeScript type guard.

**Parameters:**
- `fn` (unknown) - Value to check

**Returns:** `boolean` (type narrows to `TauriMockInstance` when true)

**Example:**
```typescript
const mock = await browser.tauri.mock('clipboard_read');
if (browser.tauri.isMockFunction(mock)) {
  // TypeScript knows mock is TauriMockInstance here
  expect(mock.mock.calls).toHaveLength(1);
}
```

---

### `browser.tauri.clearAllMocks(commandPrefix?)`

Clear all mock call history and reset results, but keep the mock implementations in place.

**Parameters:**
- `commandPrefix` (string, optional) - If provided, only mocks with command names starting with this prefix will be cleared

**Returns:** `Promise<void>`

**Example:**
```typescript
// Clear all mocks
await browser.tauri.clearAllMocks();

// Clear only clipboard-related mocks
await browser.tauri.clearAllMocks('clipboard');
```

---

### `browser.tauri.resetAllMocks(commandPrefix?)`

Reset all mocks to their initial state (clears implementations and call history).

**Parameters:**
- `commandPrefix` (string, optional) - If provided, only mocks with matching prefix are reset

**Returns:** `Promise<void>`

---

### `browser.tauri.restoreAllMocks(commandPrefix?)`

Remove all mocks and restore original command implementations.

**Parameters:**
- `commandPrefix` (string, optional) - If provided, only mocks with matching prefix are restored

**Returns:** `Promise<void>`

**Example:**
```typescript
await browser.tauri.restoreAllMocks();
// Commands now call the real Tauri backend again
```

---

### `browser.tauri.triggerDeeplink(url)`

Trigger a deeplink to the Tauri application for testing protocol handlers. Uses platform-specific commands (`open` on macOS, `xdg-open` on Linux, `cmd /c start` on Windows).

**Parameters:**
- `url` (string) - The deeplink URL to trigger (e.g., `'myapp://open?file=test.txt'`)

**Returns:** `Promise<void>`

**Example:**
```typescript
await browser.tauri.triggerDeeplink('myapp://open?file=test.txt');

await browser.waitUntil(async () => {
  const openedFile = await browser.tauri.execute(() => {
    return globalThis.lastOpenedFile;
  });
  return openedFile === 'test.txt';
});
```

See [Deeplink Testing](./deeplink-testing.md) for full usage guide.

**Browser Mode:** Not available. There is no Tauri process to receive the deeplink.

---

### `browser.tauri.switchWindow(label)`

Switch the active Tauri window for subsequent operations. Changes the window that `browser.tauri.execute()` and other Tauri-specific operations target.

**Parameters:**
- `label` (string) - The window label to switch to (e.g., `'main'`, `'settings'`)

**Returns:** `Promise<void>`

**Example:**
```typescript
// Switch to the settings window
await browser.tauri.switchWindow('settings');

// Now executes in the settings window context
const data = await browser.tauri.execute(({ core }) => core.invoke('get_settings'));

// Switch back to main window
await browser.tauri.switchWindow('main');
```

**Note:** The window label must exist in your Tauri app. Use `browser.tauri.listWindows()` to get available labels.

**Browser Mode:** Not available. Multi-window support requires a running Tauri app; there is no window-switching concept in browser mode.

---

### `browser.tauri.listWindows()`

Get a list of all available Tauri window labels in the application.

**Returns:** `Promise<string[]>`

**Example:**
```typescript
const windows = await browser.tauri.listWindows();
console.log(windows); // ['main', 'settings', 'dialog']
```

**Browser Mode:** Not available. Throws for the same reason as `switchWindow()`.

---

## Updating browser.tauri.execute with Per-Call Options

The `execute` method supports optional per-call options to override session defaults:

**Parameters:**
- `script` (Function | string) - JavaScript code to execute
- `options` (object, optional) - Per-call execution options
  - `windowLabel` (string) - Override the default window for this call only
- `...args` (any[]) - Additional arguments passed to the script

**Example:**
```typescript
import { withExecuteOptions } from '@wdio/tauri-service';

// Execute in a specific window without changing session default
const result = await browser.tauri.execute(
  (tauri) => tauri.core.invoke('get_data'),
  withExecuteOptions({ windowLabel: 'popup' })
);

// Can also pass arguments after options
const greeting = await browser.tauri.execute(
  (tauri, name) => tauri.core.invoke('greet', { name }),
  withExecuteOptions({ windowLabel: 'settings' }),
  'Alice'
);
```

---

## TauriMock Interface

When you call `browser.tauri.mock(command)`, you receive a TauriMock object with these methods:

### `mockImplementation(fn)`

Set a custom implementation function for the mock.

**Returns:** `Promise<TauriMock>`

**Example:**
```typescript
const mock = await browser.tauri.mock('calculate');
await mock.mockImplementation(async (args) => args.x + args.y);

const result = await browser.tauri.execute(({ core }) => core.invoke('calculate', { x: 5, y: 3 }));
// result === 8
```

---

### `mockImplementationOnce(fn)`

Set a custom implementation for the next call only.

**Returns:** `Promise<TauriMock>`

---

### `mockReturnValue(value)`

Set the mock to always return a specific value.

**Returns:** `Promise<TauriMock>`

**Example:**
```typescript
const mock = await browser.tauri.mock('get_user');
await mock.mockReturnValue({ id: 1, name: 'John' });
```

---

### `mockReturnValueOnce(value)`

Set the mock to return a specific value for the next call only.

**Returns:** `Promise<TauriMock>`

**Example:**
```typescript
const mock = await browser.tauri.mock('counter');
await mock.mockReturnValueOnce(1);
await mock.mockReturnValueOnce(2);
await mock.mockReturnValue(3); // default for subsequent calls
```

---

### `mockResolvedValue(value)`

Set the mock to return a promise that resolves to the given value.

**Returns:** `Promise<TauriMock>`

---

### `mockResolvedValueOnce(value)`

Set the mock to resolve to a value for the next call only.

**Returns:** `Promise<TauriMock>`

---

### `mockRejectedValue(error)`

Set the mock to return a promise that rejects with an error.

**Returns:** `Promise<TauriMock>`

**Example:**
```typescript
const mock = await browser.tauri.mock('risky_operation');
await mock.mockRejectedValue(new Error('Operation failed'));
```

---

### `mockRejectedValueOnce(error)`

Set the mock to reject for the next call only.

**Returns:** `Promise<TauriMock>`

---

### `mockClear()`

Clear the call history of this mock without resetting its implementation.

**Returns:** `Promise<TauriMock>`

---

### `mockReset()`

Reset the mock to its initial state (clears both implementation and call history).

**Returns:** `Promise<TauriMock>`

---

### `mockRestore()`

Remove this mock and restore the original command implementation.

**Returns:** `Promise<TauriMock>`

---

### `mockReturnThis()`

Set the mock to return `this` when called (useful for chaining).

**Returns:** `Promise<TauriMock>`

---

### `mockName(name)` / `getMockName()`

Set or get a display name for the mock (useful for debugging).

---

### `getMockImplementation()`

Get the current implementation function of the mock.

---

### `update()`

Sync mock call data from the inner mock (app context) to the outer mock (test process).

**Returns:** `Promise<TauriMock>`

---

### `withImplementation(implFn, callbackFn)`

Temporarily use a different implementation for the duration of a callback.

**Example:**
```typescript
const mock = await browser.tauri.mock('my_command');
await mock.mockReturnValue('default');

await mock.withImplementation(
  () => 'temporary',
  async () => {
    const result = await browser.tauri.execute(({ core }) => core.invoke('my_command'));
    console.log(result); // 'temporary'
  }
);

const result = await browser.tauri.execute(({ core }) => core.invoke('my_command'));
console.log(result); // 'default'
```

---

### Mock Properties

- `mock.calls` - Array of call arguments
- `mock.results` - Array of call results
- `__isTauriMock` - Boolean flag identifying Tauri mocks

---

## Package Exports

These functions are exported from `@wdio/tauri-service` for use in standalone mode or custom setups.

### `startWdioSession(capabilities, globalOptions?)`

Initialize the Tauri service in standalone mode. Use this when you want to manage the session manually outside of WebdriverIO's lifecycle.

**Parameters:**
- `capabilities` (Capabilities) - WebdriverIO capabilities with Tauri options
- `globalOptions?` (TauriServiceGlobalOptions) - Global service options

**Returns:** `Promise<Browser>`

**Example:**
```typescript
import { startWdioSession } from '@wdio/tauri-service';

const browser = await startWdioSession({
  browserName: 'tauri',
  'tauri:options': {
    application: './path/to/app.exe'
  }
});

// Use browser...
await browser.deleteSession();
```

---

### `cleanupWdioSession(browser)`

Clean up a Tauri session started with `startWdioSession`.

**Parameters:**
- `browser` (WebdriverIO.Browser) - Browser instance to clean up

**Returns:** `Promise<void>`

---

### `createTauriCapabilities(appBinaryPath, options?)`

Create Tauri-specific capabilities for use in WebdriverIO config.

**Parameters:**
- `appBinaryPath` (string) - Path to the Tauri app binary
- `options?` (Partial<TauriServiceOptions>) - Optional Tauri service options

**Returns:** `TauriCapabilities`

**Example:**
```typescript
import { createTauriCapabilities } from '@wdio/tauri-service';

const capabilities = createTauriCapabilities('./path/to/app.exe', {
  captureBackendLogs: true
});
```

---

## Exported Types

### `TauriCapabilities`

```typescript
interface TauriCapabilities extends WebdriverIO.Capabilities {
  browserName?: 'tauri' | 'wry';
  'tauri:options'?: {
    application: string;
    args?: string[];
    webviewOptions?: {
      width?: number;
      height?: number;
    };
  };
  'wdio:tauriServiceOptions'?: TauriServiceOptions;
}
```

### `TauriServiceOptions`

```typescript
interface TauriServiceOptions {
  appBinaryPath?: string;
  appArgs?: string[];
  tauriDriverPort?: number;
  tauriDriverPath?: string;
  logLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  commandTimeout?: number;
  startTimeout?: number;
  captureBackendLogs?: boolean;
  captureFrontendLogs?: boolean;
  backendLogLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  frontendLogLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  driverProvider?: 'official' | 'crabnebula' | 'embedded';
  embeddedPort?: number;
  statusPollTimeout?: number;
  crabnebulaDriverPath?: string;
  crabnebulaManageBackend?: boolean;
  crabnebulaBackendPort?: number;
  windowLabel?: string;
  clearMocks?: boolean;
  clearMocksPrefix?: string;
  resetMocks?: boolean;
  resetMocksPrefix?: string;
  restoreMocks?: boolean;
  restoreMocksPrefix?: string;
  env?: Record<string, string>;
  autoInstallTauriDriver?: boolean;
  autoDownloadEdgeDriver?: boolean;
  logDir?: string;
}
```

### `TauriServiceGlobalOptions`

Global options passed at the service level (not per-capability).

### `TauriResult<T>`

Uses the standard Result pattern:

```typescript
type TauriResult<T = unknown> = { ok: true; value: T } | { ok: false; error: string };

// Usage
if (result.ok) {
  console.log(result.value);  // Success case
} else {
  console.error(result.error); // Error case
}
```

### `TauriCommandContext`

```typescript
interface TauriCommandContext {
  command: string;
  args: unknown[];
  timeout?: number;
}
```

---

## Notes

- All `browser.tauri.*` methods require tauri-plugin-wdio to be installed. See [Plugin Setup](./plugin-setup.md).
- Mocking requires tauri-plugin-wdio for invoke interception to work.
- The `triggerDeeplink` method requires the `@tauri-apps/plugin-deep-link` plugin in your app.
- For detailed configuration examples, see [Configuration](./configuration.md).
