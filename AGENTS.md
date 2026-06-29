# AGENTS.md

AI context file for the WebdriverIO Desktop & Mobile Testing monorepo.

## Project Overview

This is a monorepo providing WebdriverIO services for automated testing of native desktop and mobile applications.

**Supported Frameworks:**
- **Electron** - `@wdio/electron-service` (v10.x)
- **Tauri** - `@wdio/tauri-service` (v1.x)
- **Dioxus** - `@wdio/dioxus-service` (v1.x)
- **Electrobun** - `@wdio/electrobun-service` (v0.1.x — **macOS** via CEF + **Windows** via the native WebView2 renderer (CDP), incl. multi-window/multiremote; **Linux** upstream-blocked, and deeplink/multiremote blocked on the macOS CEF path — see the package README)
- **React Native** - `@wdio/react-native-service` (v1.0.0-next.x — **Android** + **iOS**; native find/tap via Appium (UiAutomator2/XCUITest); `execute` + `mock` via Hermes CDP (debug/Metro build); full mock, deeplink, context switching, logs, parallel workers (multiremote not yet — see #446))
- **Flutter** - `@wdio/flutter-service` (v1.0.0-next.x — **Android** + **iOS**; native find/tap via appium-flutter-driver (`FLUTTER` context); `execute` (Dart expression) + `mock` (Tier-2 cooperative `wdio_flutter` Dart contract) via the Dart VM Service (debug/profile build); full mock, deeplink, context switching, logs, parallel workers (multiremote not yet — see #446)). Built on `@wdio/native-mobile-core`.

**Planned:** the generic `@wdio/mobile-service` base (ships ahead of Capacitor; React Native & Flutter converge onto it), then Capacitor and Neutralino. See [ROADMAP.md](./ROADMAP.md) for details.

## Tech Stack

| Category | Technology |
|----------|------------|
| Language | TypeScript 5.9+ (strict mode, ESM) |
| Runtime | Node.js 24 LTS |
| Package Manager | pnpm 10.27.0+ |
| Monorepo | Turborepo 2.5+ with pnpm workspaces |
| Testing | Vitest 3.2+ (unit/integration), WebdriverIO 9.0+ (E2E) |
| Linting | Biome 2.2.5 + ESLint 9.37+ |
| Build | TypeScript compiler (dual ESM/CJS) |

## Monorepo Structure

```
packages/
├── electron-service/       # Electron WDIO service
├── tauri-service/          # Tauri WDIO service
├── dioxus-service/         # Dioxus WDIO service
├── electrobun-service/     # Electrobun WDIO service
├── react-native-service/   # React Native WDIO service (Android + iOS via Appium + Hermes CDP)
├── flutter-service/        # Flutter WDIO service (Android + iOS via appium-flutter-driver + Dart VM Service)
├── native-mobile-core/     # Shared Appium-mobile layer (DeviceManager, MobileBaseLauncher, session/caps/deeplink/contexts/logs) — RN + Flutter
├── tauri-plugin/           # Tauri v2 plugin (Rust + JS)
├── dioxus-bridge/          # Dioxus bridge crate (Rust) — IPC, mocking, log forwarding
├── dioxus-embedded-driver/ # Dioxus in-process WebDriver server (Rust)
├── dioxus-driver/          # Dioxus external WebDriver proxy (Rust, Windows 'external' provider)
├── flutter-bridge/         # Flutter app-side contract (Dart, pub.dev wdio_flutter) — execute + mock + emitEvent
├── native-cdp-bridge/      # Shared CDP bridge — single + multi-target (electron, electrobun, RN)
├── native-utils/           # Cross-platform utilities
├── native-types/           # TypeScript type definitions
├── native-spy/             # Spy utilities for mocking
└── bundler/                # Build tool for packages

fixtures/
├── e2e-apps/             # E2E test applications
└── package-tests/        # Package integration test fixtures

e2e/                      # End-to-end test suites
agent-os/                 # Agent OS standards and specs
```

## Service Architecture Pattern

WDIO runs launcher and worker services in **separate processes**. Every service package splits into two classes:

```
src/
├── index.ts              # Package entry point (default=worker, named launcher=launcher)
├── launcher.ts           # Launcher service (main process)
├── service.ts            # Worker service (worker process)
├── types.ts              # TypeScript type definitions
└── constants/            # Constants and configuration
```

**Launcher** (`launcher.ts`) — runs in main process, no `browser` access:
- Hooks: `onPrepare`, `onWorkerStart`, `onWorkerEnd`, `onComplete`
- Responsibilities: binary detection, port allocation, driver spawning, capability mutation
- Throw `SevereServiceError` (from `webdriverio`) for fatal failures that should stop the runner

**Worker** (`service.ts`) — runs in worker process, receives `browser` via `before` hook:
- Hooks: `before`, `beforeTest`, `beforeCommand`, `after`, `afterSession`
- Responsibilities: API injection onto `browser`, mock lifecycle, window focus, log capture

## Logging

Use `createLogger` from `@wdio/native-utils` for all logging:

```typescript
import { createLogger } from '@wdio/native-utils';
const log = createLogger('service-name', 'module-name');
```

## Mock Architecture

Mocks span two process boundaries — an **inner mock** in the app context and an **outer mock** in the test process. The inner mock (created via `@wdio/native-spy`) intercepts real API calls inside the app. The outer mock (vitest-compatible) is used for test assertions. Call data syncs one-way from inner to outer via `update()`, serialized as JSON across CDP/WebDriver boundaries. See `agent-os/standards/global/mock-architecture.md` for details.

## Coding Standards

### TypeScript
- Strict mode enabled
- Prefer `undefined` over `null`
- ESM modules everywhere (dual CJS build for compatibility)
- Avoid `any` - use proper types
- No barrel files (`index.ts` with only re-exports) except at package roots

### Code Style
- 2 spaces indentation
- Single quotes for strings
- Trailing commas in objects/arrays
- Max line length: 120 characters
- Arrow functions for callbacks

### Comments
- Default to writing no comments. Add one only when the **why** is
  non-obvious — a hidden constraint, a subtle invariant, a workaround for a
  specific bug, behavior that would surprise a reader. If removing the
  comment wouldn't confuse a future reader, don't write it.
- Don't restate what the code already says. A descriptive variable or
  function name removes the need for a comment that describes the same
  thing in prose.
- Don't couple comments to details that drift without signal — specific
  version numbers, transient stack traces, "this used to do X". These rot
  silently as the environment changes. Keep the rationale, drop the
  citation: `// Forge silently broke packaging in a patch release` rather
  than `// Forge 7.11.2 silently broke packaging`.
- **Do** link load-bearing tracking refs — an issue or PR whose resolution
  removes or rewrites the commented code. These are the opposite of drift:
  they're an active signal to update. `// Workaround for forge/forge#4219;
  drop once a fix lands` is useful even years later.
- JSDoc for public APIs only when necessary.

## Testing

### Test Organization
```
test/
├── *.spec.ts             # Unit tests
└── integration/
    └── *.spec.ts         # Integration tests
```

### Test Requirements
- 80%+ test coverage required
- Unit tests for logic, integration tests for process management
- E2E tests in `e2e/` directory

### Running Tests
```bash
pnpm test                 # All tests
pnpm --filter @wdio/tauri-service test  # Specific package
pnpm test:integration     # Integration tests only
```

## Build Commands

```bash
pnpm build               # Build all packages
pnpm lint                # Lint all packages
pnpm typecheck           # Type check all packages
pnpm test                # Run all tests
```

## Result Type Pattern

This codebase uses a `Result<T, E>` type for operations that can fail:

```typescript
type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E }

// Usage
if (result.ok) {
  console.log(result.value);  // Success case
} else {
  console.error(result.error); // Error case
}
```

**Important:** Do not use `.success` or `.data` properties. Use `.ok` to check and `.value`/`.error` to access.

## Cross-Platform Considerations

- Windows requires `.cmd` files for shell scripts
- Use `get-port` for dynamic port allocation to avoid conflicts
- Driver processes need graceful shutdown (SIGTERM, then SIGKILL after timeout)
- File paths must handle both Unix and Windows separators

## Key Documentation

| File | Purpose |
|------|---------|
| [README.md](./README.md) | Project overview and quick start |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Contribution guidelines |
| [ROADMAP.md](./ROADMAP.md) | Framework support roadmap |
| [docs/setup.md](./docs/setup.md) | Detailed setup instructions |
| [docs/package-structure.md](./docs/package-structure.md) | Package conventions |
| [docs/architecture.md](./docs/architecture.md) | Service architecture |
| [docs/e2e-testing.md](./docs/e2e-testing.md) | E2E testing guide |

## Agent OS Integration

This project uses Agent OS v3 for AI-assisted development standards. Standards are in `agent-os/standards/` and can be injected using `/inject-standards`.

Available commands:
- `/discover-standards` - Extract patterns from codebase
- `/inject-standards` - Inject standards into context
- `/shape-spec` - Enhanced spec shaping
- `/plan-product` - Product planning

## Common Tasks

### Adding a New Service Package
1. Create `packages/<framework>-service/`
2. Follow the service architecture pattern (launcher.ts, service.ts, types.ts)
3. Add to `pnpm-workspace.yaml`
4. Update `turbo.json` with build dependencies
5. Create E2E test app in `fixtures/e2e-apps/<framework>/`

### Debugging Integration Tests
1. Tests are in `test/integration/`
2. Mock drivers are in `test/fixtures/`
3. Use `fileParallelism: false` in vitest config for port isolation
4. Check port conflicts if tests hang

### Debugging E2E Tests
1. E2E tests require built apps in `fixtures/e2e-apps/`
2. Check `e2e/wdio.*.conf.ts` for configuration
3. Protocol handlers may need setup (see `docs/e2e-testing.md`)
