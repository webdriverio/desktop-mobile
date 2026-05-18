# Browser Mode

Browser mode lets you test your Tauri frontend UI in plain Chrome against a running Vite dev server — no Tauri binary, no tauri-driver, no WebKitWebDriver or msedgedriver. Tauri commands are intercepted at the `window.__TAURI_INTERNALS__.invoke()` JavaScript boundary in the renderer, so you can mock individual commands and assert on call arguments just like in native mode.

## Overview

### What Is It?

Browser mode is a **frontend-only test mode**. Your frontend code runs for real in Chrome; the Tauri Rust backend is replaced by mocks you define per command. Same WDIO API, same frontend code path — the only thing that changes is what's on the other end of `invoke(...)` and the event plugin.

In normal (`native`) mode the service launches your compiled Tauri app, drives it via tauri-driver and a platform WebDriver, and communicates with the backend through the plugin bridge. Browser mode replaces all of that with a standard Chrome session: it sets `browserName` to `'chrome'`, navigates to your dev server URL, and injects a lightweight script that patches `window.__TAURI_INTERNALS__.invoke` so your Tauri commands can be intercepted in tests.

### Why Use It?

- **No build step needed** — point the service at `vite dev` and start testing immediately.
- **Fast feedback** — no Tauri startup, no Rust compilation, no driver negotiation.
- **Standard browser devtools** — Chrome DevTools and HMR work as normal during development.

### When to Use It

Browser mode is the right choice when your tests are renderer-focused: asserting UI state, verifying that components call the correct Tauri commands with the right arguments, or checking that the renderer handles mock responses correctly.

It is **not** suitable when your tests need to:

- Call `browser.tauri.execute()` to run code with access to the Tauri plugin bridge
- Test window management with `browser.tauri.switchWindow()` or `browser.tauri.listWindows()`
- Use `browser.tauri.triggerDeeplink()`
- Assert on real command round-trips to a running Rust backend

For those scenarios use native mode (the default).

## Setup

### 1. Start Your Dev Server

Browser mode requires a running Vite dev server. Tauri's default port is `1420`:

```bash
vite dev
# or: pnpm tauri dev (starts Vite and the Tauri binary; only Vite is needed for browser mode)
```

### 2. Configure the Service

Set `mode: 'browser'` and provide `devServerUrl` in your WDIO configuration. No `appBinaryPath`, `tauri:options`, or driver config is needed.

_`wdio.conf.ts`_

```ts
export const config = {
  services: ['@wdio/tauri-service'],
  capabilities: [
    {
      browserName: 'tauri',
      'wdio:tauriServiceOptions': {
        mode: 'browser',
        devServerUrl: 'http://localhost:1420',
      },
    },
  ],
};
```

You can also set `mode` and `devServerUrl` at the global service level so all capabilities inherit them:

```ts
export const config = {
  services: [
    [
      '@wdio/tauri-service',
      {
        mode: 'browser',
        devServerUrl: 'http://localhost:1420',
      },
    ],
  ],
  capabilities: [
    { browserName: 'tauri' },
  ],
};
```

Capability-level options take precedence over service-level ones. All capabilities in a session must use the same mode; mixing `'native'` and `'browser'` across capabilities throws a `SevereServiceError` at startup.

## IPC Mocking

### How It Works

When the session starts, the service injects a script into the page that:

1. Creates `window.__wdio_mocks__` — a registry of per-command mock functions.
2. Patches `window.__TAURI_INTERNALS__.invoke` to look up `window.__wdio_mocks__[command]` and call it; throws if the command has no registered mock.
3. Stubs `window.__TAURI_INTERNALS__.transformCallback` and related internals as no-ops where applicable.

The injection script runs again after every `browser.url()` navigation because a page load wipes `window` state.

### Mocking a Command

```ts
// In your test
const mockReadFile = await browser.tauri.mock('read_file');
await mockReadFile.mockResolvedValue('mocked file content');
```

The command name must match the string your frontend passes to `invoke()`:

```ts
// In your renderer code (e.g., via @tauri-apps/api/core)
import { invoke } from '@tauri-apps/api/core';
const content = await invoke('read_file', { path: '/some/file' });
```

### Asserting on Calls

After triggering the relevant UI action, call `update()` to sync call data from the browser-side spy to the outer mock object, then assert:

```ts
await $('button#load-file').click(); // triggers invoke('read_file', ...)

await mockReadFile.update();
expect(mockReadFile).toHaveBeenCalledTimes(1);
expect(mockReadFile.mock.calls[0]).toEqual([{ path: '/some/file' }]);
```

Element commands (`click`, `doubleClick`, `setValue`, `clearValue`) trigger `update()` automatically on all active mocks, so you often don't need to call it explicitly after those interactions.

You can also trigger a command directly from the test without a UI interaction:

```ts
await browser.execute(() => window.__TAURI_INTERNALS__.invoke('read_file', { path: '/test' }));
await mockReadFile.update();
expect(mockReadFile).toHaveBeenCalledTimes(1);
```

### Setting Implementations

All standard mock methods are available:

```ts
// Return a fixed value
await mockReadFile.mockReturnValue('file content');

// Resolve a promise (for async commands)
await mockReadFile.mockResolvedValue('file content');

// Use a function for dynamic responses
await mockReadFile.mockImplementation((args) => {
  return `content of ${args.path}`;
});

// Respond differently on the first call, then fall back
await mockReadFile.mockResolvedValueOnce('first call content');
await mockReadFile.mockResolvedValue('default content');
```

### Restoring a Mock

`mockRestore()` deregisters the command from `window.__wdio_mocks__`. After restoring, any `invoke` call to that command will throw the "unmocked command" error.

```ts
await mockReadFile.mockRestore();
```

## Events

Tauri's event API (`listen` / `once` / `unlisten` / `emit` / `emitTo` from `@tauri-apps/api/event`) works in browser mode. The IPC injection routes the underlying `plugin:event|*` invocations through an in-page listener registry, so frontend subscriptions resolve and tests can dispatch events to them.

### How It Works

The injection script:

1. Provides minimal stubs for `window.__TAURI_INTERNALS__.callbacks`, `transformCallback`, `runCallback`, and `unregisterCallback` (the bridge that real Tauri ships uses).
2. Maintains `window.__wdio_tauri_listeners__` — a per-event registry of `{ handlerId, target }` entries keyed by a monotonic event id.
3. Intercepts `plugin:event|listen` to register the handler and resolve with a numeric event id.
4. Intercepts `plugin:event|unlisten` and `__TAURI_EVENT_PLUGIN_INTERNALS__.unregisterListener` to remove handlers.
5. Intercepts `plugin:event|emit` / `plugin:event|emit_to` so they dispatch via `runCallback` to subscribed handlers, with target filtering.

If a user mock is set on `plugin:event|listen` / `unlisten` / `emit` / `emit_to`, the call is recorded by the mock for assertion purposes **and** the registry still applies the side effect — so subscriptions and dispatches keep working while you spy.

### Emitting from Tests

```ts
// Frontend
import { listen } from '@tauri-apps/api/event';
const unlisten = await listen<number>('count-updated', (e) => {
  document.querySelector('#count')!.textContent = String(e.payload);
});

// Test
await browser.tauri.emitEvent('count-updated', 42);
await expect($('#count')).toHaveText('42');
```

`browser.tauri.emitEvent()` is mode-agnostic — the same line works in native mode (where it routes through Tauri's real `event.emit()` via the plugin bridge) and in browser mode (where it routes through the in-page registry).

### Targeted Emit

Pass a third argument to restrict which listeners receive the event. Subscribers that registered with a matching `target` (or with `Any`) receive it; others do not.

```ts
// Frontend — listen only on the 'main' window
await listen('focus', cb, { target: { kind: 'AnyLabel', label: 'main' } });

// Test — emit only to 'main'
await browser.tauri.emitEvent('focus', undefined, 'main');
// Listeners registered against 'other' do NOT fire
```

The `target` argument accepts a string label (treated as `AnyLabel`) or a structured `TauriEventTarget` object: `{ kind: 'Any' | 'AnyLabel' | 'App' | 'Window' | 'Webview' | 'WebviewWindow', label?: string }`.

### Asserting on Frontend `emit()` Calls

Your frontend may call `emit()` itself (e.g. to broadcast UI events). Mock the underlying plugin command to spy on those calls — subscribers still fire because the registry runs alongside the mock:

```ts
const emitMock = await browser.tauri.mock('plugin:event|emit');

await $('button#publish').click();
await emitMock.update();

expect(emitMock).toHaveBeenCalledTimes(1);
expect(emitMock.mock.calls[0][0]).toEqual({ event: 'published', payload: { id: 7 } });
```

### `once()` Semantics

`once()` from `@tauri-apps/api/event` is built on `listen()` with a self-removing handler — no special handling is needed. The handler fires exactly once; subsequent emits are ignored.

```ts
import { once } from '@tauri-apps/api/event';
let calls = 0;
await once('one-shot', () => { calls += 1; });

await browser.tauri.emitEvent('one-shot');
await browser.tauri.emitEvent('one-shot');
// calls === 1
```

### Limitations

- **Backend-emitted Tauri-internal events** (`tauri://resize`, `tauri://focus`, etc.) only fire if the test explicitly emits them — there is no real window/webview to source them. In native mode these fire naturally as the OS events occur.
- **Listeners are wiped on navigation** — `browser.url()` rebuilds the registry. Subscriptions created before navigation will not fire afterwards. This matches the native-mode behaviour after a webview reload.
- **Other plugin commands** (e.g. `plugin:fs|*`, `plugin:dialog|*`) are not registry-routed; they no-op resolve to `undefined` unless you explicitly mock them.

## Mock Lifecycle Across Tests

### `mock(command)` Is Idempotent

Calling `browser.tauri.mock(command)` multiple times for the same command is safe, but the service always **fully resets** the existing mock (via `mockReset()`) before returning it — both call history and any previously-set implementation are cleared on every call. Set the implementation in `beforeEach` rather than relying on `beforeAll` setup persisting.

```ts
describe('File panel', () => {
  let mockReadFile: TauriMock;

  beforeEach(async () => {
    // mock() fully resets — re-set the implementation each test
    mockReadFile = await browser.tauri.mock('read_file');
    await mockReadFile.mockResolvedValue('default content');
  });

  it('displays file content', async () => {
    await $('button#load-file').click();
    await mockReadFile.update();
    expect(mockReadFile).toHaveBeenCalledTimes(1);
  });
});
```

### Clearing vs Resetting

| Method | Effect |
|--------|--------|
| `mockClear()` | Clears `.mock.calls`, `.mock.results`, `.mock.invocationCallOrder`. Implementation unchanged. |
| `mockReset()` | Clears history **and** removes the implementation (returns `undefined` on next call). |
| `mockRestore()` | Removes the mock entirely from `window.__wdio_mocks__`. |

Use `mockClear()` in `beforeEach` when you want a clean call history but want to keep the implementation set up in `beforeAll`.

## Navigation

`browser.url()` is patched by the service to re-run the IPC injection script after every navigation. This re-creates `window.__wdio_mocks__` (as an empty object) and patches `window.__TAURI_INTERNALS__.invoke` again. Existing mock handles remain valid as JS objects, but their browser-side entries are gone — calling `mock(command)` alone after navigation will not re-register them. To recover, call `mockRestore()` (which removes the entry from the worker-side store) and then `mock(command)` to re-create the browser-side entry.

```ts
it('re-registers mocks after navigation', async () => {
  let mockGetConfig = await browser.tauri.mock('get_config');
  await mockGetConfig.mockResolvedValue({ theme: 'dark' });

  // Navigate to another route — wipes window.__wdio_mocks__
  await browser.url('http://localhost:1420/settings');

  // The browser-side entry is gone. Restore (removes from store), then mock() to re-create.
  await mockGetConfig.mockRestore();
  mockGetConfig = await browser.tauri.mock('get_config');
  await mockGetConfig.mockResolvedValue({ theme: 'dark' });

  await $('button#load-config').click();
  await mockGetConfig.update();
  expect(mockGetConfig).toHaveBeenCalledTimes(1);
});
```

### Timing Caveat

The injection script runs after `browser.url()` resolves (document `readyState` is `complete`). Any `invoke()` calls your app makes during module-level initialization — before the first `DOMContentLoaded` — happen before the script is injected and will not be intercepted.

**Workaround:** Create a Vite plugin that imports the injection script as a top-level module in your dev build, so it runs before any app code.

## Limitations

| Feature | Browser Mode |
|---------|-------------|
| `browser.tauri.execute()` | Throws — no Tauri backend or plugin bridge |
| `browser.tauri.triggerDeeplink()` | Throws — no Tauri process |
| `browser.tauri.switchWindow()` | Throws — multi-window requires a native Tauri app |
| `browser.tauri.listWindows()` | Throws — same reason as `switchWindow()` |
| Backend log capture (`captureBackendLogs`) | Not available — no Rust process |
| Frontend log capture (`captureFrontendLogs`) | Available — Chrome session, standard console capture |
| Automatic window focus management | Disabled — standard Chrome window switching applies |
| `window.__TAURI_INTERNALS__.invoke` event listeners | Not intercepted — fire-and-forget listeners are no-ops |
| `mock.withImplementation()` | Serialised to browser page — see below |

### `withImplementation` in browser mode

`mock.withImplementation(implFn, callbackFn)` serialises **both** functions via `.toString()` and executes them inside the browser page using `executeAsync`. This means:

- The `callbackFn` runs in the browser page, **not** in the Node.js test-runner process.
- It cannot close over test-runner variables, call WebdriverIO commands (`browser.$()`, `browser.click()`, etc.), or use Node.js APIs (`fs`, `path`, etc.) — those symbols do not exist in the page context.
- Only use `withImplementation` when both functions are fully self-contained browser-side snippets.

For the common pattern of "use a temporary implementation while performing a UI action", use `mockImplementation` + `mockRestore` instead:

```ts
const mock = await browser.tauri.mock('read_file');
await mock.mockImplementation(() => 'temporary content');

// Perform your UI action using standard WebdriverIO commands
await $('button#load-file').click();
await mock.update();
expect(mock).toHaveBeenCalledTimes(1);

// Restore the original implementation
await mock.mockRestore();
```

## Multiremote

Each named multiremote instance gets its own isolated mock registry. Mocking the same command on two instances is safe; they do not share `window.__wdio_mocks__`.

_`wdio.conf.ts`_

```ts
export const config = {
  services: [['@wdio/tauri-service', { mode: 'browser' }]],
  capabilities: {
    app1: {
      capabilities: {
        browserName: 'tauri',
        'wdio:tauriServiceOptions': { devServerUrl: 'http://localhost:1420' },
      },
    },
    app2: {
      capabilities: {
        browserName: 'tauri',
        'wdio:tauriServiceOptions': { devServerUrl: 'http://localhost:1420' },
      },
    },
  },
};
```

```ts
// In tests — each instance mocks independently
const mock1 = await browser.getInstance('app1').tauri.mock('read_file');
const mock2 = await browser.getInstance('app2').tauri.mock('read_file');

await mock1.mockResolvedValue('content from app1');
await mock2.mockResolvedValue('content from app2');
```

## Troubleshooting

### `"unmocked Tauri command in browser mode: <command>"`

Your renderer called `invoke(command)` before a mock was registered for that command. Call `browser.tauri.mock(command)` before the code path that triggers the command.

### Mock returns `undefined` after navigation

The browser-side entry was wiped by the navigation, and calling `mock(command)` alone will not re-register it (the worker-side mock is reset but the browser-side spy is not re-created). Call `mock.mockRestore()` first to delete the worker-side entry, then call `browser.tauri.mock(command)` to re-create both sides, and re-apply any implementation you need.

### App commands during startup are not intercepted

The injection script runs after page load. If your app invokes commands during module initialization, those calls happen before the script is active. See the [timing caveat](#timing-caveat) above.

### Dev server not running

The service throws a `SevereServiceError` if `devServerUrl` is missing or not a valid URL. A connection-refused error from Chrome means the dev server is not running — start Vite before launching the test suite.
