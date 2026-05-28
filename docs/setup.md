# Monorepo Setup Guide

This guide will help you set up the WebdriverIO Desktop & Mobile monorepo for development.

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js**: Version 24 LTS (contributor toolchain — end-user Node range is defined per-package via `engines`)
  ```bash
  node --version  # Should be v24.x
  ```

- **pnpm**: Version 10.27.0 or higher
  ```bash
  npm install -g pnpm
  pnpm --version  # Should be 10.27.0+
  ```

- **Git**: For version control
  ```bash
  git --version
  ```

## Initial Setup

### 1. Clone the Repository

```bash
git clone https://github.com/webdriverio/desktop-mobile.git
cd desktop-mobile
```

### 2. Install Dependencies

```bash
pnpm install
```

This will:
- Install all root-level dependencies
- Install dependencies for all packages
- Link workspace packages together
- Set up Git hooks with Husky

### 3. Build All Packages

```bash
pnpm turbo build
```

This builds all packages in the correct dependency order using Turborepo's intelligent caching.

### 4. Run Tests

```bash
pnpm test
```

This runs tests for all packages and ensures everything is working correctly.

## Development Workflow

### Building Packages

```bash
# Build all packages
pnpm turbo build

# Build a specific package
pnpm --filter @wdio/electron-service build
pnpm --filter @wdio/tauri-service build

# Clean and rebuild
pnpm clean
pnpm turbo build
```

### Running Tests

```bash
# Run all tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Run tests for specific package
pnpm --filter @wdio/electron-service test

# Run tests in watch mode
pnpm --filter @wdio/electron-service vitest
```

### Code Quality

```bash
# Lint all packages
pnpm lint

# Lint and auto-fix
pnpm lint:fix

# Format code
pnpm format

# Type check all packages
pnpm typecheck
```

### Development Mode

```bash
# Watch mode for all packages
pnpm dev

# Watch mode for specific package
pnpm --filter wdio-electron-service dev
```

## Monorepo Structure

```
desktop-mobile/
├── .github/
│   └── workflows/          # CI/CD workflows
├── packages/               # All packages
│   ├── electron-service/       # Electron WDIO service
│   ├── tauri-service/          # Tauri WDIO service
│   ├── dioxus-service/         # Dioxus WDIO service
│   ├── tauri-plugin/           # Tauri v2 plugin (Rust + JS)
│   ├── dioxus-bridge/          # Dioxus bridge crate (Rust)
│   ├── dioxus-embedded-driver/ # Dioxus embedded WebDriver server (Rust)
│   ├── dioxus-driver/          # Dioxus external WebDriver proxy (Rust, Windows)
│   ├── electron-cdp-bridge/    # Chrome DevTools Protocol bridge
│   ├── native-utils/           # Cross-platform utilities
│   ├── native-types/           # Shared TypeScript type definitions
│   ├── native-spy/             # Spy utilities for mocking
│   └── bundler/                # Build tooling
├── fixtures/              # Test fixtures and example apps
│   ├── e2e-apps/         # E2E test applications
│   │   ├── electron-*/   # Electron E2E apps
│   │   ├── tauri/        # Tauri E2E app
│   │   └── dioxus/       # Dioxus E2E app
│   └── package-tests/     # Package test fixtures
│       └── tauri-app/     # Tauri package test app
├── e2e/                  # E2E test scenarios
├── docs/                 # Documentation
├── scripts/              # Build and utility scripts
├── package.json          # Root package.json
├── pnpm-workspace.yaml   # Workspace configuration
├── turbo.json           # Turborepo configuration
├── tsconfig.base.json   # Base TypeScript config
└── vitest.config.ts     # Vitest configuration
```

## Working with Packages

### Adding a New Package

See [package-structure.md](./package-structure.md) for detailed guidelines.

Quick steps:

1. Create package directory: `packages/my-package/`
2. Copy structure from `packages/electron-service/`
3. Update `package.json` with your package details
4. Implement your code in `src/`
5. Add tests in `test/`
6. Build: `pnpm --filter @wdio/my-package build` (use the `name` from package.json)
7. Test: `pnpm --filter @wdio/my-package test`

### Adding Dependencies

```bash
# Add dependency to specific package
pnpm --filter @wdio/electron-service add some-package

# Add dev dependency
pnpm --filter @wdio/electron-service add -D some-dev-package

# Add workspace dependency
pnpm --filter @wdio/electron-service add @wdio/native-utils@workspace:*
```

### Using the Catalog

Common dependencies are managed through pnpm's catalog feature in `pnpm-workspace.yaml`.

To use a catalog dependency:

```json
{
  "devDependencies": {
    "typescript": "catalog:default",
    "vitest": "catalog:default"
  }
}
```

## Dependency Management

The project uses three catalogs to test against different versions of key dependencies:

| Catalog | Purpose |
|---------|---------|
| `default` | Stable production versions — the reliable baseline |
| `next` | Latest/nightly versions — validates upcoming compatibility |
| `minimum` | Lowest supported versions — ensures backward compatibility |

### Switching Catalogs

```bash
pnpm catalog:default   # Switch all packages to stable versions
pnpm catalog:next      # Switch all packages to latest/nightly versions
pnpm catalog:minimum   # Switch all packages to lowest supported versions
```

### Updating Catalog Versions

```bash
# Update all catalogs and dependencies interactively
pnpm update:dependencies

# Update the Tauri version across packages (npm + Cargo.toml)
pnpm update:tauri

# Preview catalog changes without applying them
pnpm catalog:update:dry

# Target a specific catalog
pnpm catalog:update --default
pnpm catalog:update --next
pnpm catalog:update --minimum
```

The update process shows available updates, lets you select which to apply, updates `pnpm-workspace.yaml`, then runs `pnpm install`.

## Turborepo Caching

Turborepo caches task outputs to speed up subsequent runs.

### Local Cache

The local cache is stored in `.turbo/` and is automatically used.

### Cache Management

```bash
# Clear Turborepo cache
pnpm clean:cache

# Force rebuild (bypass cache)
pnpm turbo build --force
```

## Common Tasks

### Clean Everything

```bash
# Clean all build artifacts and caches
pnpm clean

# Clean just the Turbo cache
pnpm clean:cache
```

### Run CI Locally

```bash
# Run the same checks as CI
pnpm lint
pnpm typecheck
pnpm test
pnpm turbo build
```

### Update Dependencies

```bash
# Update all catalogs and dependencies interactively
pnpm update:dependencies

# Update the Tauri version across packages (npm + Cargo.toml)
pnpm update:tauri
```

## Troubleshooting

### "Cannot find module" errors

Try cleaning and reinstalling:

```bash
pnpm clean
pnpm install
pnpm turbo build
```

### TypeScript errors after adding dependencies

Rebuild the project:

```bash
pnpm turbo build --force
```

### Test failures

Make sure packages are built:

```bash
pnpm turbo build
pnpm test
```

### Pre-commit hooks not running

Reinstall Husky:

```bash
pnpm prepare
```

## IDE Setup

### VS Code

Recommended extensions:

- **ESLint**: Microsoft ESLint extension
- **Biome**: Biome formatter
- **TypeScript and JavaScript Language Features**: Built-in

Workspace settings (`.vscode/settings.json`):

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "biomejs.biome",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true,
    "source.organizeImports": true
  }
}
```

## Platform-Specific Setup

### Tauri Development

For working with Tauri packages and plugins:

1. **Install Rust** (if not already installed):
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

2. **Install Tauri CLI**:
   ```bash
   cargo install tauri-cli
   # or
   npm install -g @tauri-apps/cli
   ```

3. **Build Tauri Plugin**:
   ```bash
   cd packages/tauri-plugin
   cargo build
   ```

4. **Build Tauri Test Apps**:
   ```bash
   cd fixtures/e2e-apps/tauri
   pnpm tauri build
   ```

See the [Tauri Plugin README](../packages/tauri-plugin/README.md) for detailed setup instructions.

### Dioxus Development

For working with Dioxus packages:

1. **Install Rust** (if not already installed):
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

2. **Install Linux system dependencies** (Linux only):
   ```bash
   # Debian/Ubuntu
   sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev

   # Fedora
   sudo dnf install -y webkit2gtk4.1-devel gtk3-devel

   # Arch Linux
   sudo pacman -S webkit2gtk-4.1 gtk3
   ```

3. **Build the Dioxus Bridge Crate**:
   ```bash
   cd packages/dioxus-bridge
   cargo build
   ```

4. **Build the Dioxus Fixture App** (for E2E tests):
   ```bash
   cd fixtures/e2e-apps/dioxus
   cargo build
   ```

No Dioxus CLI (`dx`) is required for testing — the service builds and runs the app binary directly.

See the [Dioxus Bridge Setup](../packages/dioxus-service/docs/plugin-setup.md) and [Quick Start](../packages/dioxus-service/docs/quick-start.md) for detailed setup instructions.

## Next Steps

- Read [package-structure.md](./package-structure.md) for package conventions
- Read [CONTRIBUTING.md](../CONTRIBUTING.md) for contribution guidelines
- Read [AGENTS.md](../AGENTS.md) for AI assistant context and coding standards
- Explore the Electron service implementation in `packages/electron-service/`
- Explore the Tauri service implementation in `packages/tauri-service/`
- Explore the Dioxus service implementation in `packages/dioxus-service/`
- See [Tauri Plugin README](../packages/tauri-plugin/README.md) for Tauri plugin setup
- See [Dioxus Bridge Setup](../packages/dioxus-service/docs/plugin-setup.md) for Dioxus bridge setup

## AI-Assisted Development

This project uses Agent OS for AI-assisted development. The [AGENTS.md](../AGENTS.md) file contains context for AI tools like Claude Code, Cursor, and others.

Available slash commands (Claude Code):
- `/discover-standards` - Extract patterns from the codebase into documented standards
- `/inject-standards` - Inject standards into context for consistent AI assistance
- `/shape-spec` - Enhanced spec shaping with standards awareness

## Getting Help

- **Issues**: Report bugs or request features on [GitHub Issues](https://github.com/webdriverio/desktop-mobile/issues)
- **Discussions**: Ask questions on [GitHub Discussions](https://github.com/webdriverio/desktop-mobile/discussions)
- **WebdriverIO**: See [WebdriverIO documentation](https://webdriver.io/)
