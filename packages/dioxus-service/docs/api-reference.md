# API Reference

Complete API reference for @wdio/dioxus-service.

## browser.dioxus API

The following methods are available on the `browser.dioxus` object when connected to a Dioxus app.

### `browser.dioxus.execute(script, ...args)`

Execute JavaScript code in the Dioxus webview context with access to Dioxus IPC APIs. Requires `wdio-dioxus-bridge` to be installed and configured in your app.

**Parameters:**
- `script` (Function | string) - JavaScript code to execute. If a function, receives a `DioxusAPIs` object (`dx`) as the first parameter
- `...args` (any[]) - Additional arguments passed to the script

**Returns:** `Promise<ReturnValue>`

**`DioxusAPIs` (`dx`) object:**
```typescript
interface DioxusAPIs {
  invoke: (command: string, args?: unknown) => Promise<unknown>;
  log?: {
    trace: (msg: string) => void;
    debug: (msg: string) => void;
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
}
```

**Example:**
```typescript
// Execute with destructured DioxusAPIs
const result = await browser.dioxus.execute(({ invoke }) => {
  return invoke('get_platform_info');
});

// Execute with full DioxusAPIs object
const greeting = await browser.dioxus.execute(async (dx) => {
  return dx.invoke('greet', { name: 'World' });
});

// Execute with arguments
const result = await browser.dioxus.execute(
  (dx, name) => dx.invoke('greet', { name }),
  'World'
);

// Execute string of code
const href = await browser.dioxus.execute('window.location.href');
```

**Note:** Requires `wdio-dioxus-bridge` to be installed. See [Bridge Setup](./plugin-setup.md).

---

### `browser.dioxus.mock(command)`

Mock a specific Dioxus backend command. Returns a `DioxusMock` object for configuring the mock behavior.

**Parameters:**
- `command` (string) - Name of the Dioxus command to mock (must match what your app passes to `invoke()`)

**Returns:** `Promise<DioxusMock>`

**Example:**
```typescript
const mock = await browser.dioxus.mock('read_file');
await mock.mockReturnValue('mocked file content');

// Now calling invoke('read_file', ...) returns 'mocked file content'
const content = await browser.dioxus.execute(({ invoke }) => invoke('read_file'));
expect(content).toBe('mocked file content');
```

---

### `browser.dioxus.isMockFunction(fn)`

Check if a value is a Dioxus mock function. This is a TypeScript type guard.

**Parameters:**
- `fn` (unknown) - Value to check

**Returns:** `boolean` (type narrows to `DioxusMockInstance` when true)

**Example:**
```typescript
const mock = await browser.dioxus.mock('clipboard_read');
if (browser.dioxus.isMockFunction(mock)) {
  // TypeScript knows mock is DioxusMockInstance here
  expect(mock.mock.calls).toHaveLength(1);
}
```

---

### `browser.dioxus.clearAllMocks(commandPrefix?)`

Clear all mock call history and reset results, but keep the mock implementations in place.

**Parameters:**
- `commandPrefix` (string, optional) - If provided, only mocks with command names starting with this prefix will be cleared

**Returns:** `Promise<void>`

**Example:**
```typescript
// Clear all mocks
await browser.dioxus.clearAllMocks();

// Clear only clipboard-related mocks
await browser.dioxus.clearAllMocks('clipboard');
```

---

### `browser.dioxus.resetAllMocks(commandPrefix?)`

Reset all mocks to their initial state (clears implementations and call history).

**Parameters:**
- `commandPrefix` (string, optional) - If provided, only mocks with matching prefix are reset

**Returns:** `Promise<void>`

---

### `browser.dioxus.restoreAllMocks(commandPrefix?)`

Remove all mocks and restore original command implementations.

**Parameters:**
- `commandPrefix` (string, optional) - If provided, only mocks with matching prefix are restored

**Returns:** `Promise<void>`

**Example:**
```typescript
await browser.dioxus.restoreAllMocks();
// Commands now call the real Dioxus backend again
```

---

### `browser.dioxus.switchWindow(label)`

Switch the active Dioxus window for subsequent operations. Changes the window that `browser.dioxus.execute()` and other Dioxus-specific operations target.

**Parameters:**
- `label` (string) - The window label to switch to (e.g., `'main'`, `'settings'`)

**Returns:** `Promise<void>`

**Example:**
```typescript
// Switch to the settings window
await browser.dioxus.switchWindow('settings');

// Now executes in the settings window context
const data = await browser.dioxus.execute(({ invoke }) => invoke('get_settings'));

// Switch back to main window
await browser.dioxus.switchWindow('main');
```

**Note:** The window label must exist in your Dioxus app. Use `browser.dioxus.listWindows()` to get available labels.

---

### `browser.dioxus.listWindows()`

Get a list of all available Dioxus window labels in the application.

**Returns:** `Promise<string[]>`

**Example:**
```typescript
const windows = await browser.dioxus.listWindows();
console.log(windows); // ['main', 'settings', 'dialog']
```

---

### `browser.dioxus.triggerDeeplink(url)`

Trigger a deeplink to the Dioxus application for testing protocol handlers. Uses platform-specific commands (`open` on macOS, `xdg-open` on Linux, `cmd /c start` on Windows).

**Parameters:**
- `url` (string) - The deeplink URL to trigger (e.g., `'myapp://open?file=test.txt'`)

**Returns:** `Promise<void>`

**Example:**
```typescript
await browser.dioxus.triggerDeeplink('myapp://open?file=test.txt');

await browser.waitUntil(async () => {
  const openedFile = await browser.dioxus.execute(() => {
    return globalThis.lastOpenedFile;
  });
  return openedFile === 'test.txt';
});
```

See [Deeplink Testing](./deeplink-testing.md) for the full usage guide.

---

> **Note:** `emitEvent` is deferred to v1.1.

---

## DioxusMock Interface

When you call `browser.dioxus.mock(command)`, you receive a `DioxusMock` object with these methods:

### `mockImplementation(fn)`

Set a custom implementation function for the mock.

**Returns:** `Promise<DioxusMock>`

**Example:**
```typescript
const mock = await browser.dioxus.mock('calculate');
await mock.mockImplementation(async (args) => args.x + args.y);

const result = await browser.dioxus.execute(({ invoke }) => invoke('calculate', { x: 5, y: 3 }));
// result === 8
```

---

### `mockImplementationOnce(fn)`

Set a custom implementation for the next call only.

**Returns:** `Promise<DioxusMock>`

---

### `mockReturnValue(value)`

Set the mock to always return a specific value.

**Returns:** `Promise<DioxusMock>`

**Example:**
```typescript
const mock = await browser.dioxus.mock('get_user');
await mock.mockReturnValue({ id: 1, name: 'John' });
```

---

### `mockReturnValueOnce(value)`

Set the mock to return a specific value for the next call only.

**Returns:** `Promise<DioxusMock>`

**Example:**
```typescript
const mock = await browser.dioxus.mock('counter');
await mock.mockReturnValueOnce(1);
await mock.mockReturnValueOnce(2);
await mock.mockReturnValue(3); // default for subsequent calls
```

---

### `mockResolvedValue(value)`

Set the mock to return a promise that resolves to the given value.

**Returns:** `Promise<DioxusMock>`

---

### `mockResolvedValueOnce(value)`

Set the mock to resolve to a value for the next call only.

**Returns:** `Promise<DioxusMock>`

---

### `mockRejectedValue(error)`

Set the mock to return a promise that rejects with an error.

**Returns:** `Promise<DioxusMock>`

**Example:**
```typescript
const mock = await browser.dioxus.mock('risky_operation');
await mock.mockRejectedValue(new Error('Operation failed'));
```

---

### `mockRejectedValueOnce(error)`

Set the mock to reject for the next call only.

**Returns:** `Promise<DioxusMock>`

---

### `mockClear()`

Clear the call history of this mock without resetting its implementation.

**Returns:** `Promise<DioxusMock>`

---

### `mockReset()`

Reset the mock to its initial state (clears both implementation and call history).

**Returns:** `Promise<DioxusMock>`

---

### `mockRestore()`

Remove this mock and restore the original command implementation.

**Returns:** `Promise<DioxusMock>`

---

### `mockReturnThis()`

Set the mock to return `this` when called.

**Returns:** `Promise<DioxusMock>`

---

### `mockName(name)` / `getMockName()`

Set or get a display name for the mock (useful for debugging).

---

### `getMockImplementation()`

Get the current implementation function of the mock.

---

### `update()`

Sync mock call data from the inner mock (app context) to the outer mock (test process).

**Returns:** `Promise<DioxusMock>`

---

### `withImplementation(implFn, callbackFn)`

Temporarily use a different implementation for the duration of a callback.

**Example:**
```typescript
const mock = await browser.dioxus.mock('my_command');
await mock.mockReturnValue('default');

await mock.withImplementation(
  () => 'temporary',
  async () => {
    const result = await browser.dioxus.execute(({ invoke }) => invoke('my_command'));
    console.log(result); // 'temporary'
  }
);

const result = await browser.dioxus.execute(({ invoke }) => invoke('my_command'));
console.log(result); // 'default'
```

---

### Mock Properties

- `mock.calls` - Array of call arguments
- `mock.results` - Array of call results
- `__isDioxusMock` - Boolean flag identifying Dioxus mocks

---

## Package Exports

### `startWdioSession(capabilities, globalOptions?)`

Initialize the Dioxus service in standalone mode. Use this when you want to manage the session manually outside of WebdriverIO's lifecycle.

**Parameters:**
- `capabilities` (Capabilities) - WebdriverIO capabilities with Dioxus options
- `globalOptions?` (DioxusServiceGlobalOptions) - Global service options

**Returns:** `Promise<Browser>`

**Example:**
```typescript
import { startWdioSession } from '@wdio/dioxus-service';

const browser = await startWdioSession({
  browserName: 'dioxus',
  'dioxus:options': {
    application: './target/debug/my_app'
  }
});

// Use browser...
await browser.deleteSession();
```

---

## Exported Types

### `DioxusCapabilities`

```typescript
interface DioxusCapabilities extends WebdriverIO.Capabilities {
  browserName?: 'dioxus';
  'dioxus:options'?: {
    application: string;
    args?: string[];
    webviewOptions?: {
      width?: number;
      height?: number;
    };
  };
  'wdio:dioxusServiceOptions'?: DioxusServiceOptions;
}
```

### `DioxusServiceOptions`

```typescript
interface DioxusServiceOptions {
  mode?: 'native' | 'browser';
  devServerUrl?: string;
  driverProvider?: 'external' | 'embedded';
  dioxusDriverPort?: number;
  dioxusDriverPath?: string;
  embeddedPort?: number;
  appBinaryPath?: string;
  appArgs?: string[];
  env?: Record<string, string>;
  autoInstallDioxusDriver?: boolean;
  autoDownloadEdgeDriver?: boolean;
  windowLabel?: string;
  captureBackendLogs?: boolean;
  captureFrontendLogs?: boolean;
  backendLogLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  frontendLogLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  startTimeout?: number;
  statusPollTimeout?: number;
  clearMocks?: boolean;
  clearMocksPrefix?: string;
  resetMocks?: boolean;
  resetMocksPrefix?: string;
  restoreMocks?: boolean;
  restoreMocksPrefix?: string;
}
```

### `DioxusResult<T>`

Uses the standard Result pattern:

```typescript
type DioxusResult<T = unknown> = { ok: true; value: T } | { ok: false; error: string };

// Usage
if (result.ok) {
  console.log(result.value);
} else {
  console.error(result.error);
}
```

---

## Notes

- All `browser.dioxus.*` methods require `wdio-dioxus-bridge` to be installed in the Dioxus app. See [Bridge Setup](./plugin-setup.md).
- Mocking requires the bridge for invoke interception to work.
- `triggerDeeplink` requires your app to register a custom URL scheme.
- `emitEvent` is deferred to v1.1.
- For detailed configuration examples, see [Configuration](./configuration.md).
