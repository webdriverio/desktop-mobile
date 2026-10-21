# MockStore Singleton

Each service maintains a `mockStore` singleton that tracks all active mocks for bulk operations and auto-updates.

## Pattern
```typescript
class ServiceMockStore {
  #mockFns = new Map<string, ServiceMock>();

  setMock(mock: ServiceMock): ServiceMock;
  getMock(mockId: string): ServiceMock;     // throws if not found
  getMocks(): [string, ServiceMock][];      // all entries
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

All three go through `runBulkMockOp` from `@wdio/native-utils`, with the service's own name matcher:
- Every matching mock is attempted, then the failures are thrown together as one `AggregateError`. A failure is never swallowed.
- Most mock methods run their test-process half (outer mock history, plus `deleteMock` on restore) in `finally`, so a dead app still leaves the store clean. There are two exceptions, both deliberate:
  - Flutter's `mockClear`/`mockReset` are success-only. Clearing the outer mock while the Dart side still holds calls would let a later `update()` read them back.
  - React Native's `mockRestore` keeps its store entry when the uninstall fails, because its `mock()` rewires an existing entry.
- The mock registers that half with `registerLocalMockOps`, along with the connection its app calls use. A store shared across multiremote instances keys this by the mock's browser; a per-session store can omit it. Once an app call fails with a connection-level error (`isBenignTeardownError`), the remaining mocks on that connection only get their local half. Mocks on other connections still get their app calls.

## Rules
- Store key is the mock name (e.g. `electron.dialog.showOpenDialog` or `tauri.invoke`)
- Always `clear()` in session cleanup to prevent leaks across retries
- `getMock()` throws if mock not found — never return undefined
