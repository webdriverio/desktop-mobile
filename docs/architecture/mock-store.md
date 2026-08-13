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
- `clear()` — called in `afterSession` to prevent memory leaks

## Bulk Operations
These iterate the store and operate on each mock:
- `clearAllMocks()` — calls `mockClear()` on each mock
- `resetAllMocks()` — calls `mockReset()` on each mock
- `restoreAllMocks()` — calls `mockRestore()` on each mock

## Rules
- Store key is the mock name (e.g. `electron.dialog.showOpenDialog` or `tauri.invoke`)
- Always `clear()` in session cleanup to prevent leaks across retries
- `getMock()` throws if mock not found — never return undefined
