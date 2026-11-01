# MockStore Singleton

Each service maintains a `mockStore` singleton that tracks all active mocks for bulk operations and auto-updates.

## Pattern

```typescript
class ServiceMockStore {
  #mockFns = new Map<string, ServiceMock>();

  setMock(mock: ServiceMock): ServiceMock;
  getMock(mockId: string): ServiceMock; // throws if not found
  getMocks(): [string, ServiceMock][]; // all entries
  deleteMock(mockId: string): boolean;
  clear(): void;
}

const mockStore = new ServiceMockStore();
export default mockStore;
```

## Usage

- `setMock()` — called when `browser.<framework>.mock()` creates a new mock
- `getMocks()` — used by `updateAllMocks()` to sync all mocks after DOM interactions
- `clear()` — called in `afterSession` so stale mocks don't carry into the next session

## Bulk Operations

These iterate the store and operate on each mock:
- `clearAllMocks()` — calls `mockClear()` on each mock
- `resetAllMocks()` — calls `mockReset()` on each mock
- `restoreAllMocks()` — calls `mockRestore()` on each mock

All three use `runBulkMockOp` from `@wdio/native-utils`, and each service passes its own name matcher. It tries every matching mock, and if any fail, throws one `AggregateError` that lists them all.

## Keeping the outer mock in step with the app

Each mock method makes an app call, then updates the outer mock:
- `mockClear` and `mockReset` update the outer mock only after the app call succeeds. If they cleared it first and the app call failed, the app would still hold the calls, and the next `update()` would copy them back.
- `mockRestore` removes the mock from the store on every service except Electron, even when the app call fails, so the next `mock()` starts fresh. React Native removes it only after the app call succeeds, because a failed uninstall leaves the Hermes spy installed.

## Rules

- Store key is the mock name (e.g. `electron.dialog.showOpenDialog` or `tauri.invoke`)
- Always `clear()` in session cleanup to prevent leaks across retries
- `getMock()` throws if mock not found — never return undefined
