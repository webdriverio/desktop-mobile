# Migration Guide: v9 → v10

This guide highlights the changes when moving from v9 to v10 and actions needed for smooth upgrades.

## Package Name Change

The package has been renamed from `wdio-electron-service` to the scoped `@wdio/electron-service` to align with the official WebdriverIO ecosystem.

### Update Installation

**Uninstall the old package:**

```bash
npm uninstall wdio-electron-service
```

**Install the new scoped package:**

```bash
npm install --save-dev @wdio/electron-service
```

Or use your package manager of choice (pnpm, yarn, etc.).

### Update Configuration

**No changes needed** - Your WDIO configuration will continue to work as-is.

```ts
export const config = {
  services: ['electron'],
  // ...
};
```

WebdriverIO automatically resolves the `'electron'` service name to the correct package (`wdio-electron-service` in v9, `@wdio/electron-service` in v10).

### Update Imports

If you're using standalone mode or importing types/utilities from the package, update your import paths:

**Before (v9):**

```ts
import { startWdioSession, cleanupWdioSession } from 'wdio-electron-service';
import type { ElectronServiceCapabilities } from 'wdio-electron-service';
```

**After (v10):**

```ts
import { startWdioSession, cleanupWdioSession } from '@wdio/electron-service';
import type { ElectronServiceCapabilities } from '@wdio/electron-service';
```

## What's New in v10

For the full list of new features (console log capture, class mocking, deeplink testing, `electronBuilderConfig`, `getElectronBinaryPath()`, and more), see the [v10.0.0 release notes](../release-notes/v10.0.0.md). All new features are additive and require no migration action.

## Breaking Changes

### `createElectronCapabilities()` API change

The `createElectronCapabilities()` helper now accepts a single `ElectronServiceOptions` object instead of positional arguments.

**Before (v9):**

```ts
const caps = createElectronCapabilities('/path/to/binary', undefined, {
  appArgs: ['--headless'],
});
const browser = await startWdioSession([caps]);
```

**After (v10):**

```ts
const caps = createElectronCapabilities({
  appBinaryPath: '/path/to/binary',
  appArgs: ['--headless'],
});
const browser = await startWdioSession([caps]);
```

The function now returns an `ElectronStandaloneCapability` (a single object) instead of `ElectronServiceCapabilities` (a union type). All `ElectronServiceOptions` fields are accepted directly, including `captureMainProcessLogs`, `logDir`, `clearMocks`, etc.

## Verification

After updating, verify your migration:

1. **Check your package.json** - Should list `@wdio/electron-service` instead of `wdio-electron-service`
2. **Check your wdio.conf.ts** - Should use `'electron'` or `'@wdio/electron-service'` in services
3. **Run your tests** - Everything should work as before

If you encounter issues, check the [Common Issues](../common-issues.md) documentation.
