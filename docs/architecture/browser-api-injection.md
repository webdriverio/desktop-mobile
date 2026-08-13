# Browser API Injection

Worker services inject a framework-specific API onto the browser object in the `before` hook.

## Namespace

Attach to `browser.<frameworkName>`:
- `browser.electron` for Electron
- `browser.tauri` for Tauri
- `browser.dioxus` for Dioxus (future)

## API Surface (aspirational)

All services should aim to implement:

```typescript
browser.<framework> = {
  execute(script, ...args),      // Execute code in app context
  mock(apiName),                 // Mock a framework API
  clearAllMocks(),               // Clear mock call history
  resetAllMocks(),               // Reset mocks to default behavior
  restoreAllMocks(),             // Restore original implementations
  triggerDeeplink(url),          // Simulate deep link activation
};
```

Not all methods may be feasible for every framework. Unsupported methods should throw descriptive errors.

## Mock Lifecycle Integration
- Override element commands (`click`, `doubleClick`, `setValue`, `clearValue`) to trigger `updateAllMocks()` after execution
- Support `clearMocks`/`resetMocks`/`restoreMocks` options in `beforeTest` hook
- Use `mockStore` singleton to track active mocks

## Multiremote Support
- Inject API on both root multiremote browser and each individual instance
- Each instance gets its own API context (e.g. own CDP bridge for Electron)
