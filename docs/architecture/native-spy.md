# native-spy Package

`@wdio/native-spy` provides a vitest-compatible `fn()` for app contexts where vitest itself can't be bundled.

## Why It Exists
- Vitest's spy implementation has bundler dependencies that fail in Electron main process / Tauri browser context
- `native-spy` is a lightweight standalone implementation with zero dependencies
- Drop-in replacement for `@vitest/spy`

## API
```typescript
import { fn } from '@wdio/native-spy';

const mock = fn();                    // Create mock function
const mock = fn(implementation);      // Create with default implementation
```

## Vitest Compatibility
Implements the full vitest Mock interface:
- `mockClear()`, `mockReset()`, `mockRestore()`
- `mockImplementation()`, `mockImplementationOnce()`
- `mockReturnValue()`, `mockReturnValueOnce()`
- `mockResolvedValue()`, `mockRejectedValue()` (and `Once` variants)
- `mockReturnThis()`, `withImplementation()`
- `.mock` property with `calls`, `results`, `invocationCallOrder`, `instances`

## Critical Detail: `.mock` Property
The `.mock` property uses `Object.defineProperty` with `writable: false` (not a getter). This is required for CDP serialization — getters are not serialized across process boundaries.

## Marker
Mock functions are identified via `_isMockFunction: true` property.
