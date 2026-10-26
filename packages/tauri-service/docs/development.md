# Development

Guide for developing and contributing to `@wdio/tauri-service`.

## Prerequisites

See the [Monorepo Setup Guide](../../docs/setup.md) for Node.js, pnpm, and Git setup.

**Tauri-specific requirement — Rust Toolchain:**

```bash
rustc --version
cargo --version
```

Install via [rustup](https://rustup.rs) if not present.

## Setup

Follow the [Monorepo Setup Guide](../../docs/setup.md) to clone the repo and install dependencies, then build the Tauri service:

```bash
pnpm --filter @wdio/tauri-service build
```

### Watch Mode

```bash
pnpm --filter @wdio/tauri-service dev
```

## Testing

```bash
# Run all tests
pnpm --filter @wdio/tauri-service test

# Watch mode
pnpm --filter @wdio/tauri-service test:watch

# With coverage
pnpm --filter @wdio/tauri-service test:coverage
```

Aim for 80%+ coverage. Mock external dependencies where needed.

## Code Quality

See the [Monorepo Setup Guide](../../docs/setup.md#code-quality) for formatting and linting commands.

## Key Features

### Windows Edge WebDriver Management

Located in `src/edgeDriverManager.ts`:
- Detects the WebView2 version from the Tauri binary
- Auto-downloads a matching MSEdgeDriver from the Microsoft CDN
- Handles version mismatches

### Plugin Communication

`tauri-plugin-wdio` provides:
- Script execution via `window.eval()`
- Command mocking via invoke interception
- Log forwarding via event listeners

### Cross-Platform Support

| Platform | Driver                           | Status                               |
| -------- | -------------------------------- | ------------------------------------ |
| Windows  | MSEdgeDriver (auto-managed)      | Supported                            |
| Linux    | WebKitWebDriver (manual install) | Supported                            |
| macOS    | —                                | Not supported (WKWebView limitation) |

## Common Tasks

### Add a New Service Option

1. Add to `TauriServiceOptions` in `src/types.ts`
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
DEBUG=wdio-tauri-service:* npx wdio run wdio.conf.ts
```

### Debug Tests

```bash
# Run tests with Node inspector
node --inspect-brk node_modules/vitest/vitest.mjs run

# Then open chrome://inspect in Chrome
```

### Debug in VS Code

Add to `.vscode/launch.json`:

```json
{
  "type": "node",
  "request": "launch",
  "name": "Vitest Debug",
  "program": "${workspaceFolder}/node_modules/vitest/vitest.mjs",
  "args": [
    "run"
  ],
  "console": "integratedTerminal",
  "internalConsoleOptions": "neverOpen"
}
```

## Dependency Management

Dependencies are managed via the monorepo's catalog system. See [Dependency Management](../../docs/setup.md#dependency-management) for details.

## Release

Releases are managed by maintainers via GitHub Actions. See [CONTRIBUTING.md](../../CONTRIBUTING.md) for the release process.

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for contribution guidelines, commit message format, and PR process.
- **Questions**: [GitHub Discussions](https://github.com/webdriverio/desktop-mobile/discussions)
- **Bugs**: [GitHub Issues](https://github.com/webdriverio/desktop-mobile/issues)
- **Help Wanted**: [help:wanted issues](https://github.com/webdriverio/desktop-mobile/issues?q=is%3Aissue+is%3Aopen+label%3Ahelp%3Awanted+label%3Ascope%3Atauri)
- **Beginner Friendly**: [help:beginner-friendly issues](https://github.com/webdriverio/desktop-mobile/issues?q=is%3Aissue+is%3Aopen+label%3Ahelp%3Abeginner-friendly+label%3Ascope%3Atauri)

## Resources

- [WebdriverIO Documentation](https://webdriver.io)
- [Tauri Documentation](https://v2.tauri.app)
- [Tauri Plugin Development](https://v2.tauri.app/develop/plugins/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Vitest Documentation](https://vitest.dev/)
