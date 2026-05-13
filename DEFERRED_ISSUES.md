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

In `cleanup()` / `cleanupWdioSession()`, before `launcher.onComplete()`. **Important:** wrap `service.after()` in try/finally so `launcher.onComplete()` always runs even if `service.after()` rejects:

```ts
const service = activeServices.get(browser);
try {
  await service?.after();
} catch (e: unknown) {
  log.warn(`service.after() failed during cleanup: ${(e as Error).message}`);
} finally {
  activeServices.delete(browser);
}
await launcher
  .onComplete()
  .catch((e: Error) => log.warn(`launcher.onComplete() failed during cleanup: ${e.message}`));
activeLaunchers.delete(browser);
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

## Log level detector matches message content, not level token position

**Affects:** `@wdio/tauri-service`
**Pattern found in:** `@wdio/dioxus-service` (`packages/dioxus-service/src/logParser.ts`, PR #276)
**Not applicable to:** `@wdio/electron-service` (uses CDP `Runtime.consoleAPICalled` events which carry an explicit `type` field)

### Description

`detectLevel` / `extractLogLevel` in both logParsers scans the **entire trimmed line** for any occurrence of `ERROR`, `WARN`, `INFO`, etc. via a word-boundary regex. A log line like:

```
2025-01-01T12:00:00Z INFO my_module: cannot find file — check error.log
```

matches `error` first (the literal word in the message body) even though the actual log level is `INFO`. Rust `tracing` / `log` lines always emit the level as the first bracketed token after the timestamp, so anchoring the match to the beginning of the string (or to the first bracketed word) is both more accurate and faster.

### Affected code

`packages/tauri-service/src/logParser.ts` — `LOG_LEVEL_PATTERNS` array (lines 18–24):

```ts
const LOG_LEVEL_PATTERNS = [
  { level: 'error', pattern: /\b(ERROR|Error|error)\b/i },
  { level: 'warn',  pattern: /\b(WARN|Warn|warn|WARNING|...)\b/i },
  // etc. — all match anywhere in the line
];
```

### Fix

Anchor the level token to the expected position in Rust log output (timestamp + space + LEVEL):

```ts
// Match the first bracketed level token after a timestamp, e.g.:
// "2025-01-01T00:00:00Z ERROR my_crate: ..."
// "2025-01-01T00:00:00.000000Z  INFO ..."
const LOG_LEVEL_PATTERNS = [
  { level: 'error', pattern: /\bERROR\b/ },
  { level: 'warn',  pattern: /\bWARN(?:ING)?\b/ },
  { level: 'info',  pattern: /\bINFO\b/ },
  { level: 'debug', pattern: /\bDEBUG\b/ },
  { level: 'trace', pattern: /\bTRACE\b/ },
];

function extractLogLevel(line: string): LogLevel | null {
  // Only inspect the first ~40 chars where the level token lives
  const prefix = line.slice(0, 40);
  for (const { level, pattern } of LOG_LEVEL_PATTERNS) {
    if (pattern.test(prefix)) return level;
  }
  return null;
}
```

### Files to update

- `packages/tauri-service/src/logParser.ts` — `LOG_LEVEL_PATTERNS` and `extractLogLevel`

---
