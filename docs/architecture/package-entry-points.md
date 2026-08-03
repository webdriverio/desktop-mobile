# Package Entry Points

Service packages use `index.ts` as the single entry point. Keep exports minimal.

## Required Exports

```typescript
// Worker service (default export)
export { default } from './service.js';

// Launcher service (named export)
export { default as launcher } from './launcher.js';

// Session helpers
export { init as startWdioSession, cleanup as cleanupWdioSession } from './session.js';
export { create<Framework>Capabilities } from './session.js';

// Browser re-export
export const browser: WebdriverIO.Browser = wdioBrowser;

// Types
export type { ... } from './types.js';
```

## Rules
- `default` export = worker service class
- Named `launcher` export = launcher service class
- Always export session helpers (`startWdioSession`, `cleanupWdioSession`, `create*Capabilities`)
- Re-export `browser` from `@wdio/globals` for standalone usage
- Import `@wdio/native-types` for module augmentation side effects
- Keep index lean — don't re-export internal utilities, driver management, or error classes
