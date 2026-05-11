# Browser Mode

Browser mode lets you test your Electron renderer UI in plain Chrome against a running Vite (or webpack) dev server — no Electron binary, no Chromedriver, no CDP bridge. IPC calls are intercepted at the `window.electron.ipcRenderer` JavaScript boundary in the renderer, so you can mock individual channels and assert on call arguments just like in native mode.

## Overview

### What Is It?

Browser mode is a **renderer-only test mode**. Your renderer code runs for real in Chrome; the Electron main process is replaced by mocks you define per IPC channel. Same WDIO API, same renderer code path — the only thing that changes is what's on the other end of `ipcRenderer.invoke` / `send` / `sendSync` / `on`.

In normal (`native`) mode the service launches your compiled Electron app, drives it via Chromedriver, and communicates with the main process through a CDP bridge. Browser mode replaces all of that with a standard Chrome session: it sets `browserName` to `'chrome'`, navigates to your dev server URL, and injects a lightweight script that patches `ipcRenderer.invoke`, `send`, and `sendSync` so your IPC calls can be intercepted in tests.

### Why Use It?

- **No build step needed** — point the service at `vite dev` and start testing immediately.
- **Fast feedback** — no Electron startup, no binary detection, no port negotiation. The in-repo E2E suite of three specs completes in ~22s end-to-end (server start, Chrome launch, three specs), roughly 5× faster than the equivalent native script-app E2E run on the same hardware. CI Linux runner stays under the 30s budget.
- **Standard browser devtools** — Chrome DevTools and HMR work as normal during development.

### When to Use It

Browser mode is the right choice when your tests are renderer-focused: asserting UI state, verifying that components call the correct IPC channels with the right arguments, or checking that the renderer handles mock responses correctly.

It is **not** suitable when your tests need to:

- Call `browser.electron.execute()` to run code in the main process
- Test window management, native menus, or system tray behaviour
- Use `browser.electron.triggerDeeplink()`
- Assert on real IPC round-trips to a running Node.js main process

For those scenarios use native mode (the default).

## Setup

### 1. Start Your Dev Server

Browser mode requires a running dev server. Start it before running your tests:

```bash
vite dev
# or
webpack serve
```

### 2. Configure the Service

Set `mode: 'browser'` and provide `devServerUrl` in your WDIO configuration. No `appBinaryPath` or `appEntryPoint` is needed.

_`wdio.conf.ts`_

```ts
export const config = {
  services: ['electron'],
  capabilities: [
    {
      browserName: 'electron',
      'wdio:electronServiceOptions': {
        mode: 'browser',
        devServerUrl: 'http://localhost:5173',
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
      'electron',
      {
        mode: 'browser',
        devServerUrl: 'http://localhost:5173',
      },
    ],
  ],
  capabilities: [
    { browserName: 'electron' },
  ],
};
```

Capability-level options take precedence over service-level ones. All capabilities in a session must use the same mode; mixing `'native'` and `'browser'` across capabilities throws a `SevereServiceError` at startup.

## IPC Mocking

### How It Works

When the session starts, the service injects a script into the page that:

1. Creates `window.__wdio_mocks__` — a registry of per-channel mock functions.
2. Patches `window.electron.ipcRenderer.invoke` to look up `window.__wdio_mocks__[channel]` and call it; throws if the channel has no registered mock.
3. Patches `send` and `sendSync` to throw immediately for unmocked channels.
4. Stubs `on`, `once`, `removeListener`, and `removeAllListeners` as no-ops (event listeners are not supported in browser mode).

The injection script runs again after every `browser.url()` navigation because a page load wipes `window` state.

### Mocking a Channel

```ts
// In your test
const mockGetUser = await browser.electron.mock('get-user-data');
await mockGetUser.mockResolvedValue({ id: 42, name: 'Alice' });
```

The channel name must match the string your renderer passes to `ipcRenderer.invoke`:

```ts
// In your renderer code
const user = await window.electron.ipcRenderer.invoke('get-user-data');
```

### Asserting on Calls

After triggering the relevant UI action, call `update()` to sync call data from the browser-side spy to the outer mock object, then assert:

```ts
await $('button#load-user').click(); // triggers ipcRenderer.invoke('get-user-data')

await mockGetUser.update();
expect(mockGetUser).toHaveBeenCalledTimes(1);
expect(mockGetUser.mock.calls[0]).toEqual([]);
```

Element commands (`click`, `doubleClick`, `setValue`, `clearValue`) trigger `update()` automatically on all active mocks, so you often don't need to call it explicitly after those interactions.

### Setting Implementations

All standard mock methods are available:

```ts
// Return a fixed value
await mockGetUser.mockReturnValue({ id: 1, name: 'Alice' });

// Resolve a promise (for async IPC handlers)
await mockGetUser.mockResolvedValue({ id: 1, name: 'Alice' });

// Use a function for dynamic responses
await mockGetUser.mockImplementation((userId: string) => {
  return { id: userId, name: 'Dynamic User' };
});

// Respond differently on the first call, then fall back
await mockGetUser.mockResolvedValueOnce({ id: 1, name: 'First' });
await mockGetUser.mockResolvedValue({ id: 0, name: 'Default' });
```

### Restoring a Mock

`mockRestore()` deregisters the channel from `window.__wdio_mocks__`. After restoring, any `ipcRenderer.invoke` call to that channel will throw the "unmocked channel" error.

```ts
await mockGetUser.mockRestore();
```

## Events

`ipcRenderer.on(channel, listener)` / `once` / `removeListener` / `removeAllListeners` work in browser mode. The IPC injection backs them with an in-page listener registry, so frontend subscriptions land in real handlers and tests can dispatch main → renderer events from the test process.

### How It Works

The injection script:

1. Maintains `window.__wdio_electron_listeners__` — a per-channel registry of `{ id, fn, once }` entries.
2. Replaces `ipcRenderer.on` / `addListener` / `once` with implementations that push into the registry and return `ipcRenderer` (chainable, matching Electron's API).
3. Replaces `ipcRenderer.removeListener` / `off` / `removeAllListeners` with implementations that mutate the registry.
4. Exposes a `window.__wdio_emit_electron_event__(channel, ...args)` helper that dispatches a synthetic `IpcRendererEvent` (`{ ports: [], sender: ipcRenderer, senderId: 0 }`) plus the trailing args to every registered listener for that channel.

### Emitting from Tests

```ts
// Frontend
window.electron.ipcRenderer.on('did-update-info', (_event, info) => {
  document.querySelector('#status')!.textContent = info.status;
});

// Test
await browser.electron.emitEvent('did-update-info', { status: 'ready' });
await expect($('#status')).toHaveText('ready');
```

`browser.electron.emitEvent()` is mode-agnostic — the same line works in native mode (where it routes through `BrowserWindow.getFocusedWindow()?.webContents.send(channel, ...args)` and reaches the actual renderer) and in browser mode (where it routes through the in-page registry).

### `once()` Semantics

`ipcRenderer.once(channel, listener)` fires the listener exactly once; subsequent emits are ignored. The listener is removed before the call, mirroring Node.js EventEmitter behaviour.

```ts
window.electron.ipcRenderer.once('one-shot', () => { /* … */ });

await browser.electron.emitEvent('one-shot');
await browser.electron.emitEvent('one-shot');
// listener invoked once
```

### Limitations

- **Listeners are wiped on navigation** — `browser.url()` rebuilds the registry. Subscriptions created before navigation will not fire afterwards. This matches the native-mode behaviour after a renderer reload.
- **The synthetic `IpcRendererEvent` is minimal** — `event.ports` is always an empty array and `event.senderId` is always `0`. Tests that rely on rich event metadata (port transfer, IPC bridging) will need native mode.
- **Errors thrown inside a listener do not abort sibling listeners** — they're swallowed so one bad handler can't block the rest. If you need to assert on listener errors, throw a sentinel and catch it outside the listener.

## Mock Lifecycle Across Tests

### `mock(channel)` Is Idempotent

Calling `browser.electron.mock(channel)` multiple times for the same channel is safe. The service returns the existing mock unchanged if the browser-side entry is still live. If a navigation wiped `window.__wdio_mocks__`, it silently re-registers the entry and replays any previously-set implementation, but clears call history (via an internal `mockClear()`). Calls accumulated before the navigation will not appear in `mock.mock.calls` after re-registration.

This means it is safe to call `mock(channel)` in both `beforeAll` and `beforeEach`:

```ts
describe('User panel', () => {
  let mockGetUser: ElectronFunctionMock;

  beforeAll(async () => {
    mockGetUser = await browser.electron.mock('get-user-data');
    await mockGetUser.mockResolvedValue({ id: 1, name: 'Alice' });
  });

  beforeEach(async () => {
    // Safe to call again — returns the same mock, implementation is preserved
    mockGetUser = await browser.electron.mock('get-user-data');
    await mockGetUser.mockClear(); // Reset call history only
  });

  it('displays the user name', async () => {
    await $('button#load-user').click();
    await mockGetUser.update();
    expect(mockGetUser).toHaveBeenCalledTimes(1);
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

`browser.url()` is patched by the service to re-run the IPC injection script after every navigation. This re-creates `window.__wdio_mocks__` (as an empty object) and patches `ipcRenderer` again, so existing mock handles remain valid — calling `mock(channel)` after navigation re-registers the browser-side entry on demand.

```ts
it('preserves mock handles across navigation', async () => {
  const mockGetConfig = await browser.electron.mock('get-config');
  await mockGetConfig.mockResolvedValue({ theme: 'dark' });

  // Navigate to another route
  await browser.url('http://localhost:5173/settings');

  // Re-register and use — same outer mock object, fresh browser-side spy
  await browser.electron.mock('get-config');
  await mockGetConfig.mockResolvedValue({ theme: 'dark' }); // Re-set implementation
  await $('button#load-config').click();
  await mockGetConfig.update();
  expect(mockGetConfig).toHaveBeenCalledTimes(1);
});
```

### Timing Caveat

The injection script runs after `browser.url()` resolves (document `readyState` is `complete`). Any `ipcRenderer.invoke` calls your app makes during module-level initialization — before the first `DOMContentLoaded` — happen before the script is injected and will not be intercepted.

**Workaround:** Create a Vite plugin that imports the injection script as a top-level module in your dev build, so it runs before any app code.

## Limitations

| Feature | Browser Mode |
|---------|-------------|
| `browser.electron.execute()` | Throws — no main process |
| `browser.electron.mockAll()` | Throws — mock channels individually |
| `browser.electron.triggerDeeplink()` | Throws — no Electron process |
| `browser.electron.mock(apiName, funcName)` | Throws — use `mock(channel)` instead |
| `browser.electron.windowHandle` | Not meaningful — standard Chrome window handle |
| `nodeIntegration: true` preloads (no contextBridge) | Unsupported — the browser page has no `require()`. The injection creates a synthetic `window.electron.ipcRenderer` that won't match a preload that exposes a custom API shape via `nodeIntegration`. Use `contextBridge.exposeInMainWorld()` instead. |
| Automatic window focus management | Disabled — standard browser window switching applies |
| `mock.withImplementation()` | Serialised to browser page — see below |

### `withImplementation` in browser mode

`mock.withImplementation(implFn, callbackFn)` serialises **both** functions via `.toString()` and executes them inside the browser page using `executeAsync`. This means:

- The `callbackFn` runs in the browser page, **not** in the Node.js test-runner process.
- It cannot close over test-runner variables, call WebdriverIO commands (`browser.$()`, `browser.click()`, etc.), or use Node.js APIs (`fs`, `path`, etc.) — those symbols do not exist in the page context.
- Only use `withImplementation` when both functions are fully self-contained browser-side snippets.

For the common pattern of "use a temporary implementation while performing a UI action", use `mockImplementation` + `mockRestore` instead:

```ts
const mock = await browser.electron.mock('get-user-data');
await mock.mockImplementation(() => ({ id: 99, name: 'Temporary' }));

// Perform your UI action using standard WebdriverIO commands
await $('button#load-user').click();
await mock.update();
expect(mock).toHaveBeenCalledTimes(1);

// Restore the original implementation
await mock.mockRestore();
```

## Multiremote

Each named multiremote instance gets its own isolated mock registry. Mocking the same channel on two instances is safe; they do not share `window.__wdio_mocks__`.

_`wdio.conf.ts`_

```ts
export const config = {
  services: [['electron', { mode: 'browser' }]],
  capabilities: {
    app1: {
      capabilities: {
        browserName: 'electron',
        'wdio:electronServiceOptions': { devServerUrl: 'http://localhost:5173' },
      },
    },
    app2: {
      capabilities: {
        browserName: 'electron',
        'wdio:electronServiceOptions': { devServerUrl: 'http://localhost:5173' },
      },
    },
  },
};
```

```ts
// In tests — each instance mocks independently
const mock1 = await browser.getInstance('app1').electron.mock('get-user-data');
const mock2 = await browser.getInstance('app2').electron.mock('get-user-data');

await mock1.mockResolvedValue({ id: 1 });
await mock2.mockResolvedValue({ id: 2 });
```

### Navigation in multiremote

Per-instance `devServerUrl` is used for the initial navigation only. Once tests are running, `browser.url(href)` on the root navigates all instances to the same `href`. To navigate one instance to a different URL, call `url()` on the instance directly:

```ts
await browser.getInstance('app1').url('http://localhost:5173/admin');
```

`browser.electron.mock()` is unsupported on the root multiremote browser — call it on a specific instance instead. The service throws a clear error if you do otherwise.

## Troubleshooting

### `"unmocked Electron IPC channel in browser mode: <channel>"`

Your renderer called `ipcRenderer.invoke(channel)` (or `send`/`sendSync`) before a mock was registered for that channel. Call `browser.electron.mock(channel)` before the code path that triggers the IPC call.

### Mock returns `undefined` after navigation

The browser-side mock was wiped by the navigation. Call `browser.electron.mock(channel)` again to re-register it and re-apply any implementation you need.

### App IPC during startup is not intercepted

The injection script runs after page load. If your app invokes IPC during module initialization, those calls happen before the script is active. See the [timing caveat](#timing-caveat) above.

### Mock never fires / `window.electron` is the wrong shape

If your preload uses `nodeIntegration: true` without `contextBridge.exposeInMainWorld()`, browser mode cannot intercept IPC. The injection assumes a contextBridge-shaped `window.electron.ipcRenderer`. Migrate to contextBridge (see [Electron Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)) or use native mode for this test suite.

### Dev server not running

The service throws a `SevereServiceError` if `devServerUrl` is missing or not a valid URL. A connection-refused error from Chrome means the dev server is not running — start it before launching the test suite.
