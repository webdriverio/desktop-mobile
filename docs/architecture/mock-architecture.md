# Mock Architecture: Inner/Outer Pattern

Mocks span two process boundaries: the **app context** (Electron main process or browser window) and the **test context** (WDIO worker). This requires a dual-mock architecture.

## Architecture
```
Test Process (WDIO Worker)              App Process (Electron/Tauri)
┌──────────────────────────────┐    ┌──────────────────────────────┐
│  Outer Mock (vitest-compat)  │    │  Inner Mock (@wdio/native-spy)│
│  - assertions/matchers       │    │  - intercepts real API calls  │
│  - .mock.calls (for tests)   │ <── │  - tracks calls internally    │
└──────────────────────────────┘    └──────────────────────────────┘
          update()                    (one-way sync: inner → outer)
         ┌──────────────────────────────────────────┐
         │  Serialization Layer (test-process only) │
         │  @wdio/native-spy/interceptor             │
         │  - script-string builders (Tauri/Electron)│
         │  - parseCallData + safeJson               │
         │  - IpcContext seeding                     │
         └──────────────────────────────────────────┘
```

## Key Concepts
- **Inner mock** runs inside app, created via `@wdio/native-spy` (vitest can't be bundled there)
- **Outer mock** runs in test process, used for assertions
- `update()` syncs call data from inner to outer via `JSON.parse(JSON.stringify(...))`
- JSON serialization is required due to CDP/WebDriver process boundary
- Sync is **one-directional**: inner call data → outer mock
- `mockImplementation`/`mockReturnValue` methods push config from outer → inner

## Serialization Layer (`@wdio/native-spy/interceptor`)

The sub-path export `@wdio/native-spy/interceptor` is **test-process-only** (never bundled into the app).
It provides a shared `IpcInterceptor` interface for building the script strings injected into the app context.

- **Tauri** uses `createIpcInterceptor('tauri')` — all `build*Script` methods port from `tauri-service/src/mock.ts`
- **Electron** uses `createIpcInterceptor('electron')` — stub (throws `Not implemented`), filled in by a future browser-mode spec
- Transport stays in each service (`tauriExecute`, CDP, etc.) — interceptor returns strings only

Error values in `mockRejectedValue`/`mockRejectedValueOnce` are serialized with `safeJson()` as
`{ __wdioError: true, message }` and reconstructed as `new Error(message)` inside the app script.

## Mock Methods (all async)
Every mock method operates on **both** inner and outer:
- `mockImplementation(fn)` — serializes function string to inner, sets on outer
- `mockReturnValue(value)` — sets on inner via execute, sets on outer
- `mockClear()` — clears both inner and outer call history
- `mockReset()` — resets both implementations and clears history
- `mockRestore()` — restores original API in inner, clears outer

## Auto-Update Trigger
Element commands (`click`, `doubleClick`, `setValue`, `clearValue`) trigger `updateAllMocks()` to sync call data after DOM interactions.
