# @wdio/native-types

Type definitions for WebdriverIO Native Desktop Services (Electron and Tauri).

## Overview

This package provides comprehensive TypeScript type definitions for WebdriverIO Native Desktop Services, enabling type-safe development when testing Electron and Tauri applications.

## Features

### Electron Types

Complete type definitions for Electron service integration.

```typescript
import type {
  ElectronServiceOptions,
  ElectronServiceCapabilities,
  WdioElectronConfig,
  ElectronBrowserExtension,
} from '@wdio/native-types';

// Configure Electron service
const config: WdioElectronConfig = {
  capabilities: [
    {
      browserName: 'electron',
      'wdio:electronServiceOptions': {
        appPath: './dist/main.js',
        appArgs: ['--no-sandbox'],
      },
    },
  ],
};
```

### Tauri Types

Full type support for Tauri application testing.

```typescript
import type {
  TauriServiceOptions,
  TauriServiceCapabilities,
  WdioTauriConfig,
  TauriBrowserExtension,
} from '@wdio/native-types';

// Configure Tauri service
const config: WdioTauriConfig = {
  capabilities: [
    {
      browserName: 'tauri',
      'wdio:tauriServiceOptions': {
        application: './src-tauri/target/release/app',
      },
    },
  ],
};
```

### Mock Types

Type definitions for mocking in desktop application contexts.

```typescript
import type { ElectronMock, ElectronFunctionMock, TauriMock, MockResult, ServiceMockContext } from '@wdio/native-types';

// Type-safe mock usage
const mock: ElectronFunctionMock = fn();
mock.mockReturnValue('mocked result');

// Access typed mock properties
const calls = mock.calls; // Typed call history
const results = mock.results; // Typed call results
```

### Browser Extension Types

Extended WebdriverIO browser interface with native service capabilities.

```typescript
import type { BrowserExtension } from '@wdio/native-types';

// Browser now includes Electron and Tauri methods
await browser.electronAPI('some-api-call');
await browser.tauriAPI('some-tauri-call');

// Type-safe access to native service capabilities
const electronAPI = browser.electronAPI;
const tauriAPI = browser.tauriAPI;
```

### Package Types

Type definitions for package.json handling.

```typescript
import type { NormalizedPackageJson, NormalizedReadResult, ReadPackageUpOptions } from '@wdio/native-types';

const packageInfo: NormalizedReadResult = {
  packageJson: {
    name: 'my-app',
    version: '1.0.0',
    // ... fully typed
  },
  path: '/path/to/package.json',
};
```

### Result Types

Functional programming result types for error handling.

```typescript
import type { Result } from '@wdio/native-types';

// Type-safe result handling
function divide(a: number, b: number): Result<number, Error> {
  if (b === 0) {
    return { ok: false, error: new Error('Division by zero') };
  }
  return { ok: true, value: a / b };
}
```

## Global Augmentations

This package augments global types for seamless integration:

### Window Object

```typescript
// Electron-specific window properties
window.wdioElectron; // Fully typed Electron API access
```

### WebdriverIO Namespace

```typescript
// Enhanced browser interface
browser.electronAPI('method'); // Electron-specific methods
browser.tauriAPI('method'); // Tauri-specific methods

// Enhanced capabilities
const capabilities: WebdriverIO.Capabilities = {
  'wdio:electronServiceOptions': {
    /* ... */
  },
  'wdio:tauriServiceOptions': {
    /* ... */
  },
};
```

### Global Variables

```typescript
// Available in test contexts
fn; // Mock function from @wdio/native-spy
browser; // Enhanced WebdriverIO browser
packageJson; // Current package.json (when available)
__name; // Function naming utility
```

## API Reference

### Electron Types

- `ElectronServiceOptions` - Configuration for Electron service
- `ElectronServiceCapabilities` - Electron capability definitions
- `ElectronBrowserExtension` - Browser methods for Electron
- `ElectronMock` - Mock types for Electron contexts
- `WdioElectronConfig` - Complete Electron WebdriverIO configuration
- `ElectronInterface` - Available Electron APIs
- `ElectronType` - Type mappings for Electron APIs

### Tauri Types

- `TauriServiceOptions` - Configuration for Tauri service
- `TauriServiceCapabilities` - Tauri capability definitions
- `TauriBrowserExtension` - Browser methods for Tauri
- `TauriMock` - Mock types for Tauri contexts
- `WdioTauriConfig` - Complete Tauri WebdriverIO configuration
- `TauriAPIs` - The `{ core: { invoke } }` object a `browser.tauri.execute()` script receives

### Shared Types

- `Result<T, E>` - Functional result type
- `MockResult` - Mock execution results
- `MockOverride` - Mock configuration overrides
- `ServiceMockContext` - Mock context for services
- `LogLevel` - Logging level definitions
- `Fn` - Function type definitions

### Package Types

- `NormalizedPackageJson` - Standardized package.json structure
- `NormalizedReadResult` - Package reading results
- `ReadPackageUpOptions` - Options for package reading

### Browser Extensions

- `BrowserExtension` - Combined Electron + Tauri browser interface

## Usage Examples

### Complete Electron Configuration

```typescript
import type { WdioElectronConfig } from '@wdio/native-types';

export const config: WdioElectronConfig = {
  capabilities: [
    {
      browserName: 'electron',
      'wdio:electronServiceOptions': {
        appPath: './dist/main.js',
        appArgs: ['--dev'],
        env: { NODE_ENV: 'test' },
      },
    },
  ],
  services: [
    [
      'electron',
      {
        appPath: './dist/main.js',
      },
    ],
  ],
};
```

### Complete Tauri Configuration

```typescript
import type { WdioTauriConfig } from '@wdio/native-types';

export const config: WdioTauriConfig = {
  capabilities: [
    {
      browserName: 'tauri',
      'wdio:tauriServiceOptions': {
        application: './src-tauri/target/release/app',
        tauri: true,
      },
    },
  ],
  services: [
    [
      'tauri',
      {
        application: './src-tauri/target/release/app',
      },
    ],
  ],
};
```

### Type-Safe Mocking

```typescript
import type { ElectronFunctionMock } from '@wdio/native-types';
import { fn } from '@wdio/native-spy';

// Fully typed mock
const mock: ElectronFunctionMock = fn();
mock.mockReturnValue('typed result');

expect(mock()).toBe('typed result'); // TypeScript knows return type
```

## Compatibility

- **TypeScript**: 5.0+
- **Node.js**: 22.19.0+
- **WebdriverIO**: 8.0+
- **Electron**: 22.0+
- **Tauri**: 1.0+

## License

MIT
