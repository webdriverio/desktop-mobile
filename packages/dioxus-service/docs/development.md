# Development

Guide for developing and contributing to `@wdio/dioxus-service`.

## Prerequisites

See the [Monorepo Setup Guide](../../docs/setup.md) for Node.js, pnpm, and Git setup.

**Dioxus-specific requirement — Rust Toolchain:**

```bash
rustc --version
cargo --version
```

Install via [rustup](https://rustup.rs) if not present.

## Setup

Follow the [Monorepo Setup Guide](../../docs/setup.md) to clone the repo and install dependencies, then build the Dioxus service:

```bash
pnpm --filter @wdio/dioxus-service build
```

### Watch Mode

```bash
pnpm --filter @wdio/dioxus-service dev
```

## Building the Dioxus Fixture App

The E2E fixture app must be built before running E2E tests:

```bash
cd fixtures/e2e-apps/dioxus
cargo build
```

This produces a debug binary with `wdio-dioxus-bridge` active (because the build is in debug mode, `#[cfg(debug_assertions)]` is satisfied).

## Testing

### Unit Tests

```bash
pnpm --filter @wdio/dioxus-service test:unit
```

### Integration Tests

```bash
pnpm --filter @wdio/dioxus-service test:integration
```

### All Tests

```bash
pnpm --filter @wdio/dioxus-service test
```

### With Coverage

```bash
pnpm --filter @wdio/dioxus-service test:coverage
```

Coverage threshold: ≥ 80% statement coverage, as per [AGENTS.md](../../AGENTS.md).

### Watch Mode

```bash
pnpm --filter @wdio/dioxus-service test:watch
```

## E2E Tests

Run the full E2E suite against the built fixture app:

```bash
# Embedded provider (all platforms)
cd e2e && pnpm wdio run wdio.dioxus-embedded.conf.ts

# External provider (Windows only)
cd e2e && pnpm wdio run wdio.dioxus-external.conf.ts
```

Platform-specific notes:
- **Linux**: Run under Xvfb: `xvfb-run -a pnpm wdio run wdio.dioxus-embedded.conf.ts`
- **Windows `'external'`**: Requires `wdio-dioxus-driver` and msedgedriver (auto-managed)

## Code Quality

See the [Monorepo Setup Guide](../../docs/setup.md#code-quality) for formatting and linting commands.

## Key Features

### Embedded Driver Provider

Located in `src/providers/embedded.ts`:

- Spawns the Dioxus app with `DIOXUS_WEBVIEW_AUTOMATION=true` and `DIOXUS_WEBVIEW_AUTOMATION_PORT`
- Polls the embedded WebDriver server `/status` endpoint on startup
- Each worker gets a unique port (basePort + workerIndex)

### External Driver Provider (Windows)

Located in `src/providers/external.ts`:

- Spawns `wdio-dioxus-driver` which proxies to `msedgedriver.exe`
- Auto-downloads matching msedgedriver version
- Only active on Windows; throws `SevereServiceError` on Linux and macOS

### Bridge Communication

`wdio-dioxus-bridge` provides:

- Script execution via the `wdio://` custom protocol
- Command mocking via invoke interception (guest-js bundle)
- Log forwarding via the bridge's log pipeline

### Cross-Platform Support

| Platform | Provider | Status |
|----------|----------|--------|
| Windows | `embedded` | Supported |
| Windows | `external` | Supported |
| Linux | `embedded` | Supported |
| Linux | `external` | v1.1 (blocked upstream) |
| macOS | `embedded` | Supported |
| macOS | `external` | Not supported |

## Spike Findings

The `spike/FINDINGS.md` document explains why `'external'` on Linux is deferred to v1.1: the upstream Dioxus/Wry codebase does not yet expose the automation toggle that `wdio-dioxus-driver` needs to pass to enable WebView2/WebKitGTK automation mode. Once the upstream PR lands, this block will be removed.

## Common Tasks

### Add a New Service Option

1. Add to `DioxusServiceOptions` in `packages/native-types/src/dioxus.ts`
2. Add a default value in the service class
3. Add validation if needed
4. Write tests

### Add a New API Function

1. Implement in `src/`
2. Export from `src/index.ts`
3. Add TypeScript types
4. Write tests

### Fix a Platform-Specific Issue

1. Identify affected platforms (`windows`, `linux`, `darwin`)
2. Add platform detection if needed
3. Implement the fix
4. Test on affected platforms or add platform-specific unit tests

## Debugging

### Enable Debug Logging

```bash
npx wdio run wdio.conf.ts --logLevel debug
```

### Debug Tests

```bash
node --inspect-brk node_modules/vitest/vitest.mjs run
# Then open chrome://inspect in Chrome
```

## Dependency Management

Dependencies are managed via the monorepo's catalog system. See [Dependency Management](../../docs/setup.md#dependency-management) for details.

## Release

Releases are managed by maintainers via GitHub Actions. See [CONTRIBUTING.md](../../CONTRIBUTING.md) for the release process.

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for contribution guidelines, commit message format, and PR process.

- **Questions**: [GitHub Discussions](https://github.com/webdriverio/desktop-mobile/discussions)
- **Bugs**: [GitHub Issues](https://github.com/webdriverio/desktop-mobile/issues)
- **Help Wanted**: [help:wanted issues](https://github.com/webdriverio/desktop-mobile/issues?q=is%3Aissue+is%3Aopen+label%3Ahelp%3Awanted+label%3Ascope%3Adioxus)

## Resources

- [WebdriverIO Documentation](https://webdriver.io)
- [Dioxus Documentation](https://dioxuslabs.com/learn/0.6/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Vitest Documentation](https://vitest.dev/)
