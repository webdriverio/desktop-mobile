# Browser Mode

Browser mode lets you test your Dioxus frontend UI in plain Chrome against a running dev server — no Dioxus binary, no driver. The Dioxus invoke API is intercepted at the JavaScript boundary in the renderer, so you can mock individual commands and assert on call arguments just like in native mode.

## Overview

### What Is It?

Browser mode is a **frontend-only test mode**. Your frontend code runs for real in Chrome; the Dioxus Rust backend is replaced by mocks you define per command. Same WDIO API, same frontend code path — the only thing that changes is what's on the other end of `invoke(...)`.

In normal (`native`) mode the service launches your compiled Dioxus app, drives it via the configured driver provider, and communicates with the backend through the bridge. Browser mode replaces all of that with a standard Chrome session: it sets `browserName` to `'chrome'`, navigates to your dev server URL, and injects a lightweight script that patches the invoke API so your Dioxus commands can be intercepted in tests.

### Why Use It?

- **No build step needed** — point the service at a dev server and start testing immediately.
- **Fast feedback** — no Dioxus startup, no Rust compilation, no driver negotiation.
- **Standard browser devtools** — Chrome DevTools and HMR work as normal during development.

### When to Use It

Browser mode is the right choice when your tests are renderer-focused: asserting UI state, verifying that components call the correct Dioxus commands with the right arguments, or checking that the renderer handles mock responses correctly.

It is **not** suitable when your tests need to:

- Call `browser.dioxus.execute()` to run code with access to the bridge
- Test window management with `browser.dioxus.switchWindow()` or `browser.dioxus.listWindows()`
- Use `browser.dioxus.triggerDeeplink()`
- Assert on real command round-trips to a running Rust backend

For those scenarios use native mode (the default).

## Setup

### 1. Start Your Dev Server

Browser mode requires a running dev server that serves your frontend code.

### 2. Configure the Service

Set `mode: 'browser'` and provide `devServerUrl` in your WDIO configuration. No `appBinaryPath`, `dioxus:options`, or driver config is needed.

_`wdio.conf.ts`_

```ts
export const config = {
  services: ['@wdio/dioxus-service'],
  capabilities: [
    {
      browserName: 'dioxus',
      'wdio:dioxusServiceOptions': {
        mode: 'browser',
        devServerUrl: 'http://localhost:8080',
      },
    },
  ],
};
```

You can also set `mode` and `devServerUrl` at the global service level:

```ts
export const config = {
  services: [
    [
      '@wdio/dioxus-service',
      {
        mode: 'browser',
        devServerUrl: 'http://localhost:8080',
      },
    ],
  ],
  capabilities: [
    { browserName: 'dioxus' },
  ],
};
```

Capability-level options take precedence over service-level ones. All capabilities in a session must use the same mode; mixing `'native'` and `'browser'` across capabilities throws a `SevereServiceError` at startup.

## IPC Mocking

### How It Works

When the session starts, the service injects a script into the page that:

1. Creates `window.__wdio_mocks__` — a registry of per-command mock functions.
2. Patches the Dioxus invoke API to look up `window.__wdio_mocks__[command]` and call it; throws if the command has no registered mock.

The injection script runs again after every `browser.url()` navigation because a page load wipes `window` state.

### Mocking a Command

```ts
const mockReadFile = await browser.dioxus.mock('read_file');
await mockReadFile.mockResolvedValue('mocked file content');
```

### Asserting on Calls

After triggering the relevant UI action, call `update()` to sync call data from the browser-side spy to the outer mock object, then assert:

```ts
await $('button#load-file').click();

await mockReadFile.update();
expect(mockReadFile).toHaveBeenCalledTimes(1);
expect(mockReadFile.mock.calls[0]).toEqual([{ path: '/some/file' }]);
```

Element commands (`click`, `doubleClick`, `setValue`, `clearValue`) trigger `update()` automatically on all active mocks.

### Setting Implementations

```ts
// Return a fixed value
await mockReadFile.mockReturnValue('file content');

// Resolve a promise (for async commands)
await mockReadFile.mockResolvedValue('file content');

// Use a function for dynamic responses
await mockReadFile.mockImplementation((args) => {
  return `content of ${args.path}`;
});

// Respond differently on first call, then fall back
await mockReadFile.mockResolvedValueOnce('first call content');
await mockReadFile.mockResolvedValue('default content');
```

### Restoring a Mock

```ts
await mockReadFile.mockRestore();
```

## Mock Lifecycle Across Tests

### `mock(command)` Is Idempotent

Calling `browser.dioxus.mock(command)` multiple times for the same command is safe, but the service always fully resets the existing mock (via `mockReset()`) before returning it — both call history and any previously-set implementation are cleared on every call. Set the implementation in `beforeEach` rather than relying on `beforeAll` setup persisting.

```ts
describe('File panel', () => {
  let mockReadFile: DioxusMock;

  beforeEach(async () => {
    mockReadFile = await browser.dioxus.mock('read_file');
    await mockReadFile.mockResolvedValue('default content');
  });

  it('displays file content', async () => {
    await $('button#load-file').click();
    await mockReadFile.update();
    expect(mockReadFile).toHaveBeenCalledTimes(1);
  });
});
```

## Navigation

`browser.url()` is patched by the service to re-run the IPC injection script after every navigation. This re-creates `window.__wdio_mocks__` (as an empty object). Existing mock handles remain valid as JS objects, but their browser-side entries are gone. To recover, call `mockRestore()` first and then `mock(command)` to re-create the browser-side entry.

## Limitations

| Feature | Browser Mode |
|---------|-------------|
| `browser.dioxus.execute()` | Throws — no Dioxus backend or bridge |
| `browser.dioxus.triggerDeeplink()` | Throws — no Dioxus process |
| `browser.dioxus.switchWindow()` | Throws — multi-window requires a native Dioxus app |
| `browser.dioxus.listWindows()` | Throws — same reason as `switchWindow()` |
| Backend log capture (`captureBackendLogs`) | Not available — no Rust process |
| Frontend log capture (`captureFrontendLogs`) | Available — Chrome session, standard console capture |

## Multiremote

Each named multiremote instance gets its own isolated mock registry.

```ts
export const config = {
  services: [['@wdio/dioxus-service', { mode: 'browser' }]],
  capabilities: {
    app1: {
      capabilities: {
        browserName: 'dioxus',
        'wdio:dioxusServiceOptions': { devServerUrl: 'http://localhost:8080' },
      },
    },
    app2: {
      capabilities: {
        browserName: 'dioxus',
        'wdio:dioxusServiceOptions': { devServerUrl: 'http://localhost:8080' },
      },
    },
  },
};
```

```ts
const mock1 = await browser.getInstance('app1').dioxus.mock('read_file');
const mock2 = await browser.getInstance('app2').dioxus.mock('read_file');

await mock1.mockResolvedValue('content from app1');
await mock2.mockResolvedValue('content from app2');
```

## Troubleshooting

### `"unmocked Dioxus command in browser mode: <command>"`

Your renderer called `invoke(command)` before a mock was registered. Call `browser.dioxus.mock(command)` before the code path that triggers the command.

### Mock returns `undefined` after navigation

The browser-side entry was wiped by navigation. Call `mock.mockRestore()` first to delete the worker-side entry, then `browser.dioxus.mock(command)` to re-create both sides.

### Dev server not running

The service throws a `SevereServiceError` if `devServerUrl` is missing or not a valid URL. A connection-refused error from Chrome means the dev server is not running — start it before launching the test suite.
