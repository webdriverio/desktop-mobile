# Mock Wrapper Pattern

Vitest's `fn()` creates a mock with a non-configurable `.mock` property. To provide auto-updating mock state across process boundaries, we use a wrapper function pattern.

## Why Wrappers
- Vitest's `.mock` property is `configurable: false` — can't redefine it
- We need `.mock` to return auto-updating state from the inner mock
- The wrapper delegates to the original mock but exposes a custom `.mock` getter

## Pattern
```typescript
// 1. Create original mock
const outerMock = vitestFn();
const originalMock = outerMock.mock;

// 2. Create wrapper function
const wrapperMock = ((...args) => mock(...args)) as ServiceMock;

// 3. Copy all properties except mock/length/name
Object.getOwnPropertyNames(mock).forEach((key) => {
  if (key !== 'mock' && key !== 'length' && key !== 'name') {
    const descriptor = Object.getOwnPropertyDescriptor(mock, key);
    if (descriptor) Object.defineProperty(wrapperMock, key, descriptor);
  }
});

// 4. Define .mock as getter to original state
Object.defineProperty(wrapperMock, 'mock', {
  configurable: false,
  enumerable: false,
  get: () => originalMock,
});

// 5. Bind all methods to the wrapper
wrapperMock.mockImplementation = mock.mockImplementation.bind(mock);
// ... all other methods
```

## Rules
- Always return the wrapper, not the original mock
- Bind all methods from original mock onto wrapper
- Set `__isElectronMock` / `__isTauriMock` on wrapper for identification
- Prototype chain: `Object.setPrototypeOf(wrapper, Object.getPrototypeOf(mock))`
