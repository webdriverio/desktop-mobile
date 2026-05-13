# Coexistence with Other Services

This guide explains how to run `@wdio/dioxus-service` alongside `@wdio/tauri-service` and `@wdio/electron-service` in the same monorepo.

## Overview

Each service is designed to be independent. They share `@wdio/native-types` for TypeScript types and `@wdio/native-spy` for mock utilities, but they do not interfere with each other when configured correctly.

## Capability Disambiguation

Each service identifies its target app via `browserName`:

| Service | `browserName` |
|---------|---------------|
| `@wdio/dioxus-service` | `'dioxus'` |
| `@wdio/tauri-service` | `'tauri'` |
| `@wdio/electron-service` | `'electron'` |

When a WDIO runner starts, each service checks the `browserName` of each capability and only takes ownership of capabilities matching its framework. Unrecognized capabilities are passed through untouched.

## Separate Config Files Per Service

The recommended approach is to maintain a separate `wdio.conf.ts` per framework:

```
your-monorepo/
├── apps/
│   ├── dioxus-app/         # Dioxus app source
│   ├── tauri-app/          # Tauri app source
│   └── electron-app/       # Electron app source
├── e2e/
│   ├── test/
│   │   ├── dioxus/         # Dioxus E2E specs
│   │   ├── tauri/          # Tauri E2E specs
│   │   └── electron/       # Electron E2E specs
│   ├── wdio.dioxus.conf.ts
│   ├── wdio.tauri.conf.ts
│   └── wdio.electron.conf.ts
```

### `wdio.dioxus.conf.ts`

```typescript
export const config = {
  specs: ['./test/dioxus/**/*.spec.ts'],
  services: [['@wdio/dioxus-service', {
    driverProvider: 'embedded',
  }]],
  capabilities: [{
    browserName: 'dioxus',
    'dioxus:options': {
      application: '../apps/dioxus-app/target/debug/dioxus_app',
    },
  }],
};
```

### `wdio.tauri.conf.ts`

```typescript
export const config = {
  specs: ['./test/tauri/**/*.spec.ts'],
  services: [['@wdio/tauri-service', {
    driverProvider: 'embedded',
  }]],
  capabilities: [{
    browserName: 'tauri',
    'tauri:options': {
      application: '../apps/tauri-app/src-tauri/target/debug/tauri_app',
    },
  }],
};
```

### `wdio.electron.conf.ts`

```typescript
export const config = {
  specs: ['./test/electron/**/*.spec.ts'],
  services: [['@wdio/electron-service', {
    appBinaryPath: '../apps/electron-app/dist/my-app',
  }]],
  capabilities: [{
    browserName: 'electron',
  }],
};
```

## Running Specific Suites

```bash
# Dioxus tests only
npx wdio run wdio.dioxus.conf.ts

# Tauri tests only
npx wdio run wdio.tauri.conf.ts

# Electron tests only
npx wdio run wdio.electron.conf.ts
```

Or with package scripts:

```json
{
  "scripts": {
    "test:e2e:dioxus": "wdio run wdio.dioxus.conf.ts",
    "test:e2e:tauri": "wdio run wdio.tauri.conf.ts",
    "test:e2e:electron": "wdio run wdio.electron.conf.ts",
    "test:e2e": "run-p test:e2e:*"
  }
}
```

## Shared Types — No Conflicts

All three services share `@wdio/native-types` for TypeScript type definitions. The types for each service are namespaced to avoid conflicts:

| Type | Service |
|------|---------|
| `DioxusServiceOptions` | `@wdio/dioxus-service` |
| `TauriServiceOptions` | `@wdio/tauri-service` |
| `ElectronServiceOptions` | `@wdio/electron-service` |

The capability extensions are also namespaced:

| Capability key | Service |
|----------------|---------|
| `'dioxus:options'` | Dioxus |
| `'wdio:dioxusServiceOptions'` | Dioxus |
| `'tauri:options'` | Tauri |
| `'wdio:tauriServiceOptions'` | Tauri |
| `'wdio:electronServiceOptions'` | Electron |

## Mixed-Service Test Session (Advanced)

If you want to run Dioxus and Tauri tests in a single WDIO session (not recommended for most cases), both services can coexist in the same config:

```typescript
export const config = {
  specs: ['./test/**/*.spec.ts'],
  services: [
    ['@wdio/dioxus-service', { driverProvider: 'embedded' }],
    ['@wdio/tauri-service', { driverProvider: 'embedded' }],
  ],
  capabilities: [
    {
      browserName: 'dioxus',
      'dioxus:options': {
        application: './target/debug/my_dioxus_app',
      },
    },
    {
      browserName: 'tauri',
      'tauri:options': {
        application: './src-tauri/target/debug/my_tauri_app',
      },
    },
  ],
};
```

Each service only activates for capabilities with a matching `browserName`. The Dioxus service ignores `tauri:options` capabilities and vice versa.

## Port Management

If running multiple services simultaneously, ensure their embedded ports do not conflict:

```typescript
services: [
  ['@wdio/dioxus-service', { driverProvider: 'embedded', embeddedPort: 4445 }],
  ['@wdio/tauri-service', { driverProvider: 'embedded', embeddedPort: 4450 }],
],
```

## CI Matrix

For CI, test each framework in parallel across OS runners:

```yaml
# .github/workflows/e2e.yml
jobs:
  e2e-dioxus:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: cargo build
        working-directory: apps/dioxus-app
      - run: npm run test:e2e:dioxus

  e2e-tauri:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: cargo build
        working-directory: apps/tauri-app/src-tauri
      - run: npm run test:e2e:tauri

  e2e-electron:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - run: npm run build:electron-app
      - run: npm run test:e2e:electron
```

## See Also

- [@wdio/tauri-service README](../../tauri-service/README.md)
- [@wdio/electron-service README](../../electron-service/README.md)
- [Configuration](./configuration.md)
- [Platform Support](./platform-support.md)
