# Package Test Applications

This directory contains simple package test applications that serve two purposes:
1. Demonstrate different ways to use `wdio-electron-service` and `wdio-tauri-service` in real-world applications
2. Serve as package tests to validate basic service functionality and module system compatibility (CJS/ESM) during development

These package tests are intentionally minimal and unlikely to be expanded in scope; the E2E test suite used for fully testing service functionality can be found in the [e2e](/e2e) directory and the apps which are tested by that suite are in the [e2e-apps](/fixtures/e2e-apps/) directory.

Note that the package tests are fully self-contained with no dependency on other parts of the repo, this is to ensure that they can be copied to a temporary directory and executed as part of the [package testing](/scripts/test-package.ts).

## Module System Testing

Package tests include both **CJS** and **ESM** variants for Electron applications to test module system compatibility. This is where CJS/ESM issues are caught early during service startup, making it the appropriate place for module system validation.

## Available Package Tests

### Electron Applications

Each Electron package test has both CJS and ESM variants:

#### [electron-builder-app-cjs](./electron-builder-app-cjs/) and [electron-builder-app-esm](./electron-builder-app-esm/)

```
📦 Electron Builder + electron-vite
├── Uses Electron Builder for packaging
├── TypeScript support
├── Version and app name IPC examples
└── Tests covering app functionality and electron APIs
```

#### [electron-forge-app-cjs](./electron-forge-app-cjs/) and [electron-forge-app-esm](./electron-forge-app-esm/)

```
🔨 Electron Forge + electron-vite
├── Uses Electron Forge for packaging
├── TypeScript support
├── Version and app name IPC examples
└── Tests covering app functionality and electron APIs
```

#### [electron-script-app-cjs](./electron-script-app-cjs/) and [electron-script-app-esm](./electron-script-app-esm/)

```
📝 Simple npm scripts + electron-vite
├── Minimal configuration approach
├── TypeScript support
├── Version and app name IPC examples
└── Tests covering app functionality and electron APIs
```

### Tauri Applications

#### [tauri-app](./tauri-app/)

```
🦀 Tauri application
├── Uses Tauri v2 for desktop app
├── TypeScript support
├── Tauri plugin integration
└── Tests covering Tauri API functionality
```

## Common Features

All examples demonstrate:
- electron-vite for building and development
- TypeScript support
- IPC communication between main and renderer processes
- WebdriverIO test configuration and patterns
- Context isolation and security best practices
- Modern Electron application structure

## Testing Features Demonstrated

### Core Service Features

- ✅ Electron API Access via `browser.electron.execute()`
- ✅ IPC Communication Testing
- ✅ Security Validation (context isolation, preload scripts)

### UI Testing

- ✅ Element Interaction
- ✅ Content Validation
- ✅ Dynamic Updates

## Quick Start

Each example can be run independently:

```bash
cd <package-directory>

# Install dependencies
pnpm install

# Build the app (for builder and forge examples)
pnpm build

# Run the tests
pnpm test
```
