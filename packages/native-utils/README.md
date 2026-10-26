# @wdio/native-utils

Utilities for WebdriverIO Native Desktop Services.

## Overview

This package provides essential utilities for WebdriverIO Native Desktop Services (Electron and Tauri), including configuration management, diagnostics, package handling, and cross-platform executable management.

## Features

### Configuration Management

Read and parse configuration files (JSON, YAML, TOML) with support for environment variable substitution.

```typescript
import { readConfig } from '@wdio/native-utils';

const config = await readConfig('./config.json');
// Supports JSON, YAML, and TOML formats
```

### Diagnostics

Comprehensive diagnostic utilities for troubleshooting desktop application issues.

```typescript
import { diagnoseBinary, diagnosePlatform, diagnoseDisplay, formatDiagnosticResults } from '@wdio/native-utils';

// Check binary paths
const binaryResult = await diagnoseBinary('/path/to/binary');

// Get platform information
const platformInfo = diagnosePlatform();

// Check display capabilities
const displayInfo = await diagnoseDisplay();

// Format results for logging
const formatted = formatDiagnosticResults([binaryResult, platformInfo, displayInfo]);
```

### Package Management

Utilities for reading and working with package.json files.

```typescript
import { readPackageUp, readPackageUpSync } from '@wdio/native-utils';

// Find and read package.json upward from current directory
const result = readPackageUp();
if (result.ok) {
  console.log('Package name:', result.value.packageJson.name);
}

// Synchronous version
const syncResult = readPackageUpSync();
```

### Result Types

Functional programming style Result types (Ok/Err pattern) for error handling.

```typescript
import { Ok, Err, isOk, isErr, unwrap, wrapAsync } from '@wdio/native-utils';

// Create successful results
const success = Ok('data');
console.log(isOk(success)); // true

// Create error results
const failure = Err(new Error('Something went wrong'));
console.log(isErr(failure)); // true

// Unwrap with error throwing
const data = unwrap(success); // 'data'
const error = unwrap(failure); // throws Error

// Wrap async functions
const asyncResult = await wrapAsync(() => fetchData());
```

### Executable Management

Cross-platform executable selection and validation.

```typescript
import { selectExecutable, validateBinaryPaths } from '@wdio/native-utils';

// Select best available executable from options
const executable = selectExecutable(['electron', 'electron.exe'], '/custom/path');

// Validate binary paths
const validation = await validateBinaryPaths(['/path/to/electron', '/path/to/tauri']);
```

### Window Utilities

Utilities for working with application windows.

```typescript
import { waitUntilWindowAvailable } from '@wdio/native-utils';

// Wait for a window to become available
await waitUntilWindowAvailable('My App Window', { timeout: 5000 });
```

### Logging

Structured logging utilities.

```typescript
import { createLogger } from '@wdio/native-utils';

const log = createLogger('my-service', 'module-name');
log.info('Application started');
log.error('Something went wrong', error);
```

## API Reference

### Configuration

- `readConfig(path: string)` - Read and parse configuration files

### Diagnostics

- `diagnoseBinary(path: string)` - Check binary file information
- `diagnosePlatform()` - Get platform-specific information
- `diagnoseDisplay()` - Check display capabilities
- `diagnoseDiskSpace(path?: string)` - Check available disk space
- `diagnoseLinuxDependencies()` - Check Linux system dependencies
- `diagnoseSharedLibraries(binaryPath: string)` - Check shared library dependencies
- `formatDiagnosticResults(results: DiagnosticResult[])` - Format diagnostic results

### Package Management

- `readPackageUp(options?: ReadPackageUpOptions)` - Find and read package.json upward
- `readPackageUpSync(options?: ReadPackageUpOptions)` - Synchronous version

### Result Types

- `Ok<T>(value: T)` - Create successful result
- `Err<E>(error: E)` - Create error result
- `isOk<T>(result: Result<T, any>)` - Check if result is success
- `isErr(result: Result<any, any>)` - Check if result is error
- `unwrap<T>(result: Result<T, any>)` - Get value or throw error
- `unwrapOr<T>(result: Result<T, any>, defaultValue: T)` - Get value or default
- `map<T, U>(result: Result<T, any>, fn: (value: T) => U)` - Transform success value
- `mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F)` - Transform error value
- `wrapAsync<T>(fn: () => Promise<T>)` - Wrap async function in Result

### Executable Management

- `selectExecutable(candidates: string[], customPath?: string)` - Select best executable
- `validateBinaryPaths(paths: string[])` - Validate multiple binary paths

### Window Management

- `waitUntilWindowAvailable(windowTitle: string, options?: { timeout?: number })` - Wait for window

### Logging

- `createLogger(name: string, area?: string)` - Create structured logger

## License

MIT
