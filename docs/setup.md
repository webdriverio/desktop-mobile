# Monorepo Setup Guide

This guide will help you set up the WebdriverIO Desktop & Mobile monorepo for development.

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js**: Version 24 LTS (contributor toolchain — end-user Node range is defined per-package via `engines`)

  ```bash
  node --version  # Should be v24.x
  ```

- **pnpm**: Version 12 ([installation](https://pnpm.io/installation)); `package.json` pins the exact version

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
pnpm build
```

This builds every package in `packages/`, in dependency order, and Turborepo caches the results. It doesn't build the fixture apps; see [e2e-testing.md](./e2e-testing.md) for those.

### 4. Run Tests

```bash
pnpm turbo run test --filter=./packages/*
```

This runs every package's unit tests. Avoid the root `pnpm test`: it also runs the E2E and package tests, which need built apps.

## Development Workflow

### Building Packages

```bash
# Build all packages
pnpm build

# Build a specific package
pnpm --filter @wdio/electron-service build
pnpm --filter @wdio/tauri-service build

# Clean and rebuild
pnpm clean
pnpm build
```

### Running Tests

```bash
# Run every package's tests
pnpm turbo run test --filter=./packages/*

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
# Rebuild a package when its source changes
pnpm --filter @wdio/electron-service dev
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

| Catalog   | Purpose                                                                                |
| --------- | -------------------------------------------------------------------------------------- |
| `default` | Stable production versions — the reliable baseline                                     |
| `next`    | Electron nightly and WebdriverIO's upcoming release — catches breakage before it ships |
| `minimum` | Lowest supported versions — ensures backward compatibility                             |

### Switching Catalogs

```bash
pnpm catalog:default   # Switch all packages to stable versions
pnpm catalog:next      # Switch all packages to upcoming versions
pnpm catalog:minimum   # Switch all packages to lowest supported versions
```

### Updating Catalog Versions

```bash
# Update all catalogs and dependencies interactively, then run update:tauri
pnpm update:dependencies

# Sync the Tauri fixtures to the latest stable Tauri (npm + Cargo.toml) and run cargo update
pnpm update:tauri

# Preview catalog changes without applying them
pnpm catalog:update:dry

# Target a specific catalog
pnpm catalog:update --default
pnpm catalog:update --next
pnpm catalog:update --minimum
```

The update process shows available updates, lets you select which to apply, updates `pnpm-workspace.yaml`, then runs `pnpm install`. In the `next` catalog, it pins each package that has a fixed version to its upcoming release, the newer of its `next` and `latest` tags, or to the newest version before that one if the release is too new for pnpm's `minimumReleaseAge`. WebdriverIO's packages follow `webdriverio`, and wait if one of them hasn't published its version yet. Every update is ticked.

### WebdriverIO Majors

The services support two WebdriverIO majors at once: their `webdriverio` and `@wdio/*` peer ranges allow the current major and the previous one. The `default` catalog holds the current major, and `minimum` holds the previous one.

CI runs on the current major. The `wdio-v9.yml` workflow checks the previous one:

- It builds, type-checks and unit-tests the packages on `minimum` nightly, and on PRs that touch them.
- It runs the Linux package tests, with the fixtures' WebdriverIO packages from `minimum`, weekly, when dispatched, on a PR with the `ci:wdio-v9` label, and when a release label is added to a PR.

To run a package test on the previous major locally, pass `--wdio-catalog=minimum`, as in `pnpm test:package:electron -- --wdio-catalog=minimum`.

When a new WebdriverIO major ships:

1. Move `default` to the new major and `minimum` to the one before it, and move the services' peer ranges with them. Dropping the oldest major is a breaking change for the services.
2. Match the packages' Node `engines` to the new `webdriverio`'s.
3. Rename `wdio-v9.yml`, its workflow name, its `v9` job names and the `ci:wdio-v9` label after the new previous major.
4. Drop the job-wide Xvfb (`.github/workflows/actions/start-xvfb`) if the new previous major starts its own display, as v10 does.
5. Update the two checks on the `minimum` catalog in `test/scripts/switch-catalog.spec.ts`: the major it holds, and the WebdriverIO packages it may lack.

## Turborepo Caching

Turborepo caches task outputs to speed up subsequent runs.

### Local Cache

The local cache is stored in `.turbo/` and is automatically used.

### Cache Management

```bash
# Clear Turborepo cache
pnpm clean:cache

# Force rebuild (bypass cache)
pnpm build --force
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
pnpm turbo run test --filter=./packages/*
pnpm build
```

### Update Dependencies

```bash
# Update all catalogs and dependencies interactively, then run update:tauri
pnpm update:dependencies

# Sync the Tauri fixtures to the latest stable Tauri (npm + Cargo.toml) and run cargo update
pnpm update:tauri

# Move GitHub Actions uses: pins to their newest tags
pnpm update:actions

# update:dependencies, then update:actions
pnpm update:all

# Bump @releasekit/release and its workflow pins together. Not part of update:all.
pnpm update:releasekit
```

## Troubleshooting

### "Cannot find module" errors

Try cleaning and reinstalling:

```bash
pnpm clean
pnpm install
pnpm build
```

### TypeScript errors after adding dependencies

Rebuild the project:

```bash
pnpm build --force
```

### Test failures

Make sure packages are built:

```bash
pnpm build
pnpm turbo run test --filter=./packages/*
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
   sudo apt-get install -y libwebkit2gtk-4.1-dev libgtk-3-dev libxdo-dev

   # Fedora
   sudo dnf install -y webkit2gtk4.1-devel gtk3-devel libxdo-devel

   # Arch Linux
   sudo pacman -S webkit2gtk-4.1 gtk3 xdotool
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

See the [Dioxus App Setup](../packages/dioxus-service/docs/app-setup.md) and [Quick Start](../packages/dioxus-service/docs/quick-start.md) for detailed setup instructions.

## Next Steps

- Read [package-structure.md](./package-structure.md) for package conventions
- Read [CONTRIBUTING.md](../CONTRIBUTING.md) for contribution guidelines
- Read [AGENTS.md](../AGENTS.md) for AI assistant context and coding standards
- Explore the Electron service implementation in `packages/electron-service/`
- Explore the Tauri service implementation in `packages/tauri-service/`
- Explore the Dioxus service implementation in `packages/dioxus-service/`
- See [Tauri Plugin README](../packages/tauri-plugin/README.md) for Tauri plugin setup
- See [Dioxus App Setup](../packages/dioxus-service/docs/app-setup.md) for Dioxus app setup

## AI-Assisted Development

[AGENTS.md](../AGENTS.md) holds the repo's guidance for coding agents. Claude Code, Codex, Cursor and others read it. Claude Code also loads the skills in `.claude/skills/`, such as `add-native-service`.

## Getting Help

- **Issues**: Report bugs or request features on [GitHub Issues](https://github.com/webdriverio/desktop-mobile/issues)
- **Discussions**: Ask questions on [GitHub Discussions](https://github.com/webdriverio/desktop-mobile/discussions)
- **WebdriverIO**: See [WebdriverIO documentation](https://webdriver.io/)
