# Deferred Issues

Issues found during the Dioxus service work that also apply to the Tauri and/or Electron services. To be addressed in follow-up PRs after `feat/dioxus-macos` merges.

---

## `service.after()` never called in standalone sessions

**Affects:** `@wdio/tauri-service`, `@wdio/electron-service`
**Pattern fixed in:** `@wdio/dioxus-service` (`packages/dioxus-service/src/session.ts`, PR #279)

### Description

`startWdioSession()` / `init()` creates a `WorkerService` instance and calls `service.before()`, which wires up mock infrastructure (the mock store, the IPC interceptor, window state). The service instance is then discarded — it is not stored alongside the `activeLaunchers` entry. As a result, `cleanupWdioSession()` / `cleanup()` can only reach `launcher.onComplete()` and never calls `service.after()`, which is responsible for clearing the process-wide mock store and window state cache.

**Consequence:** any caller that uses `mock()` between `startWdioSession` and `cleanupWdioSession` leaves stale entries in `mockStore`; a subsequent session in the same process sees those stale mocks. The window registry also accumulates dead entries.

### Fix (already applied to Dioxus)

Add a second `WeakMap` alongside `activeLaunchers`:

```ts
const activeServices = new WeakMap<WebdriverIO.Browser, WorkerService>();
```

In `init()` / `startWdioSession()`, after `service.before()`:

```ts
activeServices.set(browser, service);
```

In `cleanup()` / `cleanupWdioSession()`, before `launcher.onComplete()`:

```ts
const service = activeServices.get(browser);
await service?.after();
activeServices.delete(browser);
```

### Files to update

- `packages/tauri-service/src/session.ts` — `TauriWorkerService` / `activeLaunchers`
- `packages/electron-service/src/session.ts` — `ElectronWorkerService` / launcher map

---

## `remote()` failure does not clean up the launcher process

**Affects:** `@wdio/tauri-service`, `@wdio/electron-service`
**Pattern fixed in:** `@wdio/dioxus-service` (`packages/dioxus-service/src/session.ts`, PR #279)

### Description

When `remote()` fails (connection refused, timeout, etc.) the launcher process — tauri-driver, Electron main process, or the embedded WebDriver server — is left running indefinitely. The caller never receives a `browser` object and therefore cannot call `cleanup()`.

- **Tauri** (`packages/tauri-service/src/session.ts` ~line 128): has a `.catch()` that logs the error and rethrows, but does **not** call `launcher.onComplete()`. The tauri-driver and msedgedriver processes leak.
- **Electron** (`packages/electron-service/src/session.ts` ~line 67): no `.catch()` at all on `remote()`. Same leak.

### Fix (already applied to Dioxus)

Add (or extend) the `.catch()` on `remote()` to call `launcher.onComplete()` before rethrowing:

```ts
const browser = await remote({ ... }).catch(async (error: Error) => {
  log.error(`Failed to create remote session: ${error.message}`);
  await launcher
    .onComplete()
    .catch((e: Error) => log.warn(`Cleanup failed: ${e.message}`));
  throw error;
});
```

### Files to update

- `packages/tauri-service/src/session.ts` — extend existing `.catch()` to call `launcher.onComplete()`
- `packages/electron-service/src/session.ts` — add `.catch()` on `remote()` with `launcher.onComplete()`

---

## `service.before()` throwing after `remote()` succeeds leaks browser session and launcher

**Affects:** `@wdio/tauri-service`, `@wdio/electron-service`
**Pattern fixed in:** `@wdio/dioxus-service` (`packages/dioxus-service/src/session.ts`, PR #279)

### Description

If `remote()` succeeds but `service.before()` subsequently throws (e.g. IPC setup failure, browser augmentation error), `init()` / `startWdioSession()` propagates the error to the caller. The caller never receives a valid `browser` object and cannot call `cleanup()`. The open WebDriver session and the launcher subprocess are both left running indefinitely.

- **Tauri** (`packages/tauri-service/src/session.ts` ~line 140): `service.before()` called after `remote()` with no error handler.
- **Electron** (`packages/electron-service/src/session.ts` ~line 74): same, no error handler.

### Fix (already applied to Dioxus)

Wrap `service.before()` in a try/catch that tears down the open session and stops the launcher before rethrowing:

```ts
try {
  await service.before(capabilities, [], browser);
} catch (error) {
  await browser
    .deleteSession()
    .catch((e: Error) => log.warn(`Failed to delete session: ${e.message}`));
  await launcher
    .onComplete()
    .catch((e: Error) => log.warn(`Failed to stop driver: ${e.message}`));
  activeLaunchers.delete(browser);
  throw error;
}
```

### Files to update

- `packages/tauri-service/src/session.ts` — wrap `service.before()` call (~line 140)
- `packages/electron-service/src/session.ts` — wrap `service.before()` call (~line 74)

---
