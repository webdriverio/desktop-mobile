# E2E Testing Guide

This guide covers end-to-end testing for the WebdriverIO Desktop & Mobile services.

## Overview

E2E tests verify the complete integration of WDIO services with real applications. They run against built applications in `fixtures/e2e-apps/` using WebdriverIO's test runner.

## Test Organization

```
e2e/
├── test/
│   ├── electron/           # Electron E2E tests
│   │   ├── api.spec.ts
│   │   ├── dialog.spec.ts
│   │   ├── mock.spec.ts
│   │   └── ...
│   ├── tauri/              # Tauri E2E tests
│   │   ├── api.spec.ts
│   │   ├── logging.spec.ts
│   │   └── ...
│   ├── dioxus/             # Dioxus E2E tests
│   │   ├── api.spec.ts
│   │   ├── mock.spec.ts
│   │   └── ...
│   └── electrobun/         # Electrobun E2E tests (macOS-only; CI runs the `standard` suite)
│       ├── api.spec.ts
│       └── ...
├── lib/                    # Shared test utilities
├── wdio.electron.conf.ts   # Electron WDIO config
├── wdio.tauri.conf.ts      # Tauri WDIO config
├── wdio.tauri-embedded.conf.ts  # Tauri embedded WDIO config
├── wdio.dioxus-embedded.conf.ts # Dioxus embedded WDIO config
└── wdio.electrobun.conf.ts # Electrobun WDIO config (CDP-attach, macOS-only)

fixtures/e2e-apps/
├── electron-builder/       # Electron app (builder packaging)
├── electron-forge/         # Electron app (forge packaging)
├── electron-no-binary/     # Electron app (no binary mode)
├── electron-script/        # Electron app (script mode)
├── tauri/                  # Tauri app
└── dioxus/                 # Dioxus app
```

## Running E2E Tests

### Prerequisites

1. **Build the apps first:**
   ```bash
   # Build all E2E apps
   pnpm turbo build --filter electron-builder-e2e-app
   pnpm turbo build --filter electron-forge-e2e-app
   pnpm turbo build --filter tauri-e2e-app

   # Build the Dioxus E2E app (Rust — no pnpm filter)
   cd fixtures/e2e-apps/dioxus && cargo build
   ```

2. **Build the services:**
   ```bash
   pnpm build
   ```

3. **Platform-specific requirements:**
   - **Windows**: No special requirements
   - **macOS**: May need to allow app execution in Security settings
   - **Linux**: May need to install `webkit2gtk-driver` for Tauri; requires a display server (or Xvfb) for Dioxus

### Running Tests

```bash
# Electron tests (builder packaging)
pnpm --filter @repo/e2e test:e2e:electron-builder

# Electron tests (forge packaging)
pnpm --filter @repo/e2e test:e2e:electron-forge

# Electron tests (script mode)
pnpm --filter @repo/e2e test:e2e:electron-script

# Tauri tests
pnpm --filter @repo/e2e test:e2e:tauri-basic

# Tauri specific modes
pnpm --filter @repo/e2e test:e2e:tauri-basic:window
pnpm --filter @repo/e2e test:e2e:tauri-basic:multiremote
pnpm --filter @repo/e2e test:e2e:tauri-basic:standalone

# Dioxus tests (embedded provider, all platforms)
pnpm --filter @repo/e2e test:e2e:dioxus-embedded
```

## Configuration

### Electron Configuration (`wdio.electron.conf.ts`)

```typescript
export const config: WebdriverIO.Config = {
  services: [
    [
      'electron',
      {
        appBinaryPath: './path/to/app',
        appArgs: ['--arg1', '--arg2'],
      },
    ],
  ],
  // ...
};
```

### Tauri Configuration (`wdio.tauri.conf.ts`)

```typescript
export const config: WebdriverIO.Config = {
  services: ['tauri'],
  capabilities: [{
    browserName: 'tauri',
    'tauri:options': {
      application: '/path/to/app/binary',
    },
  }],
  // ...
};
```

### Dioxus Configuration (`wdio.dioxus-embedded.conf.ts`)

The `'embedded'` provider is the recommended default and works on all three platforms (Windows, macOS, Linux).

```typescript
import { join } from 'node:path';
import type { Options } from '@wdio/types';

const appBinaryPath = join(
  __dirname,
  '../fixtures/e2e-apps/dioxus/target/debug/dioxus-e2e-app',
);

export const config: Options.Testrunner = {
  runner: 'local',
  framework: 'mocha',
  services: [
    [
      '@wdio/dioxus-service',
      {
        driverProvider: 'embedded',
        embeddedPort: 4445,
      },
    ],
  ],
  capabilities: [{
    browserName: 'dioxus',
    'dioxus:options': {
      application: appBinaryPath,
    },
  }],
  specs: ['test/dioxus/**/*.spec.ts'],
};
```

#### Provider matrix

| Provider | Windows | macOS | Linux | Notes |
|---|---|---|---|---|
| `'embedded'` (default) | ✅ | ✅ | ✅ | Recommended for all platforms |
| `'external'` | ✅ | ❌ | ❌ (v1.1) | Windows-only in v1; Linux support deferred |

For the `'external'` provider on Windows, see [edge-webdriver-windows.md](../packages/dioxus-service/docs/edge-webdriver-windows.md).

## Test Modes

### Single Browser

Default mode - single browser instance:

```typescript
capabilities: [{
  browserName: 'tauri',
  'tauri:options': {
    application: appBinaryPath,
  },
}],
```

### Multiremote

Multiple browser instances simultaneously:

```typescript
capabilities: {
  browserA: {
    capabilities: {
      browserName: 'tauri',
      'tauri:options': { application: appBinaryPath },
    },
  },
  browserB: {
    capabilities: {
      browserName: 'tauri',
      'tauri:options': { application: appBinaryPath },
    },
  },
},
```

For Dioxus multiremote, replace `'tauri:options'` with `'dioxus:options'` and `browserName: 'dioxus'`.

### Per-Worker

When `maxInstances > 1`, the service automatically spawns a separate driver per worker:

```typescript
// wdio.conf.ts
maxInstances: 3,  // Enables per-worker mode automatically
capabilities: [{
  browserName: 'tauri',
  'tauri:options': {
    application: appBinaryPath,
  },
}],
```

## Debugging E2E Tests

### Enable Debug Logging

```bash
pnpm e2e:tauri-basic -- --logLevel debug
pnpm e2e:electron-builder -- --logLevel debug
```

### Run Specific Test

```bash
pnpm wdio wdio.tauri.conf.ts --spec test/tauri/api.spec.ts
pnpm wdio wdio.dioxus-embedded.conf.ts --spec test/dioxus/api.spec.ts
```

### Common Issues

#### Port Conflicts

If tests hang, check for port conflicts:

```bash
# Check what's using the default port
lsof -i :4444
lsof -i :4445  # Dioxus embedded driver default port

# Kill stale processes
kill -9 <PID>
```

#### App Not Found

Ensure app is built and path is correct:

```bash
ls -la fixtures/e2e-apps/tauri/src-tauri/target/debug/
ls -la fixtures/e2e-apps/dioxus/target/debug/
```

#### Dioxus Bridge Not Active

The embedded driver only starts when the Dioxus app is built in **debug mode** — the bridge is compiled behind `#[cfg(debug_assertions)]`. Release builds will not expose the WebDriver endpoint. Always use `cargo build` (not `cargo build --release`) for E2E test apps.

#### Linux: No Display

Dioxus (like Tauri) requires a display server on Linux. For CI use Xvfb:

```yaml
- name: Run Dioxus E2E tests
  run: |
    export DISPLAY=:99
    Xvfb :99 -screen 0 1280x800x24 &
    pnpm --filter @repo/e2e test:e2e:dioxus-embedded
```

#### Protocol Handler Not Registered

For Tauri deep link tests, the protocol handler must be registered. Setup scripts are provided per app:

```bash
# From root - protocol install runs automatically before E2E tests
pnpm e2e:tauri-basic
pnpm e2e:electron-builder

# Run protocol install only
pnpm protocol-install:tauri
pnpm protocol-install:electron-builder
```

Each app has platform-specific setup scripts in `fixtures/e2e-apps/<app>/scripts/` that detect the OS and register the protocol handler. These scripts are idempotent — running them multiple times is safe as they check if the protocol is already registered and skip if so.

For Dioxus deep link testing see [deeplink-testing.md](../packages/dioxus-service/docs/deeplink-testing.md).

## CI Integration

### GitHub Actions

E2E tests run in CI with matrix configuration:

```yaml
strategy:
  matrix:
    os: [ubuntu-latest, windows-latest, macos-latest]
    include:
      - os: macos-latest
        arch: x64
      - os: macos-latest
        arch: arm64
```

#### Dioxus CI example

```yaml
- name: Build Dioxus E2E app
  run: cargo build
  working-directory: fixtures/e2e-apps/dioxus

- name: Run Dioxus E2E tests (Linux — Xvfb required)
  if: runner.os == 'Linux'
  run: |
    export DISPLAY=:99
    Xvfb :99 -screen 0 1280x800x24 &
    pnpm --filter @repo/e2e test:e2e:dioxus-embedded

- name: Run Dioxus E2E tests (Windows / macOS)
  if: runner.os != 'Linux'
  run: pnpm --filter @repo/e2e test:e2e:dioxus-embedded
```

### Platform-Specific Notes

| Platform | Notes |
|----------|-------|
| Windows | Requires `.cmd` for scripts, Edge driver for WebView2 |
| macOS | Universal builds tested separately, may need security overrides |
| Linux | Requires `webkit2gtk-driver` for Tauri; Xvfb for Dioxus |

## Adding New E2E Tests

1. **Create test file** in `e2e/test/<framework>/`
2. **Add test utilities** in `e2e/lib/` if needed
3. **Update configuration** if new capabilities needed
4. **Add to CI** in `.github/workflows/ci.yml`
5. **Document** in this file

## Best Practices

1. **Isolate tests** - Each test should be independent
2. **Clean up state** - Reset app state between tests
3. **Use meaningful selectors** - Prefer `data-testid` attributes
4. **Avoid flaky patterns** - Use explicit waits, not fixed timeouts
5. **Log strategically** - Add context for debugging, but avoid spam
6. **Test user flows** - Focus on real user interactions, not implementation details
