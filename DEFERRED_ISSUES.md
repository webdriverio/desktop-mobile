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
