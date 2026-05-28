# Contributing to WebdriverIO Desktop & Mobile Testing Services

Thank you for your interest in contributing! This document provides guidelines and instructions for contributing to this project.

## Code of Conduct

Please be respectful and constructive in all interactions. We aim to create a welcoming environment for all contributors.

## Getting Started

### Prerequisites

- Node.js 24 LTS (contributor toolchain — end-user Node range is defined per-package via `engines`)
- pnpm 10.27.0
- Git

For Tauri and Dioxus contributions, you also need:

- Rust (stable toolchain via `rustup`)

### Setup

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/desktop-mobile.git
   cd desktop-mobile
   ```
3. Install dependencies:
   ```bash
   pnpm install
   ```
4. Build all packages:
   ```bash
   pnpm turbo build
   ```
5. Run tests to verify setup:
   ```bash
   pnpm test
   ```

See [docs/setup.md](docs/setup.md) for detailed setup instructions.

## Development Workflow

### 1. Create a Branch

Create a new branch for your changes:

```bash
git checkout -b feature/my-feature
# or
git checkout -b fix/my-bugfix
```

Branch naming conventions:

- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation changes
- `refactor/` - Code refactoring
- `test/` - Test improvements
- `chore/` - Build/tooling changes

### 2. Make Your Changes

- Write code following our [coding standards](#coding-standards)
- Add tests for new functionality
- Update documentation as needed
- Ensure tests pass: `pnpm test`
- Ensure linting passes: `pnpm lint`

### 3. Commit Your Changes

We use conventional commits for clear commit history:

```bash
git add .
git commit -m "feat: add new feature"
```

Commit message format:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

Types:

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Build process or tooling changes
- `perf`: Performance improvements

Scope:

Scope by **framework**, not package name. Most changes that touch a service, its plugin, fixtures, and E2E tests are all part of the same logical unit of work. For cross-cutting changes, omit the scope.

```bash
# Framework-scoped (changes within one framework's ecosystem)
git commit -m "feat(tauri): complete mocking"
git commit -m "fix(electron): windows multiremote"
git commit -m "fix(dioxus): embedded port conflict on linux"

# No scope (cross-cutting or shared changes)
git commit -m "refactor: extract shared diagnostics to native-utils"
git commit -m "docs: update installation instructions"
git commit -m "chore: update deps"
```

### 4. Push and Create Pull Request

```bash
git push origin feature/my-feature
```

Then create a pull request on GitHub with:

- Clear title describing the change
- Description of what changed and why
- Reference to any related issues
- Screenshots (if applicable)

## Coding Standards

### TypeScript

- Use **TypeScript strict mode**
- Prefer `undefined` over `null`
- Use **ESM** (ES Modules) everywhere
- Avoid `any` - use proper types
- JSDoc for public APIs only when necessary (prefer self-documenting code)

### Code Style

- Use **2 spaces** for indentation
- Use **single quotes** for strings
- Use **trailing commas** in objects and arrays
- Max line length: **120 characters**
- Use **arrow functions** for callbacks

Our linters (Biome and ESLint) will auto-fix most style issues:

```bash
pnpm lint:fix
pnpm format
```

### Project Structure

- No **barrel files** (`index.ts` with only re-exports) except in package roots
- Avoid **nested ternaries** - extract logic for readability
- Use meaningful names for files and directories
- Keep files focused - one main export per file

## Testing

### Test Requirements

- All code must have **80%+ test coverage**
- Write tests for:
  - New features
  - Bug fixes
  - Edge cases
  - Error handling

### Writing Tests

We use **Vitest** for testing:

```typescript
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

describe('MyFeature', () => {
  it('should do something', () => {
    expect(doSomething()).toBe(expected);
  });

  it('should handle errors', () => {
    expect(() => doSomethingBad()).toThrow('Error message');
  });
});
```

### Running Tests

```bash
# Run all tests
pnpm test

# Run tests for specific package
pnpm --filter @wdio/electron-service test

# Run tests with coverage
pnpm test:coverage

# Run tests in watch mode
pnpm --filter @wdio/electron-service vitest
```

## Documentation

### Code Documentation

- JSDoc for public APIs only when necessary
- Prefer self-documenting code over comments
- No comments unless the logic isn't self-evident

### README Files

- Each package must have a comprehensive README
- Include installation, usage, API docs, and examples
- Keep READMEs up to date with code changes

### Documentation Files

- Update `docs/` when adding new features
- Update CHANGELOG.md for notable changes

## Pull Request Process

### Before Submitting

Ensure your PR passes all checks:

```bash
# Build all packages
pnpm turbo build

# Run linting
pnpm lint

# Run type checking
pnpm typecheck

# Run all tests
pnpm test

# Run tests with coverage
pnpm test:coverage
```

### PR Checklist

- [ ] Code follows project conventions
- [ ] Tests added/updated and passing
- [ ] Test coverage ≥ 80%
- [ ] Documentation updated
- [ ] Commit messages follow convention
- [ ] No TypeScript errors
- [ ] Linting passes
- [ ] All CI checks passing

### Review Process

1. Maintainers will review your PR
2. Address any requested changes
3. Once approved, a maintainer will merge

## Package-Specific Guidelines

### Electron Service

When contributing to the Electron service:

- Maintain backward compatibility
- Test on Windows, macOS, and Linux
- Test with both Electron Forge and Builder
- Test with ESM and CJS configurations

### Tauri Service

When contributing to the Tauri service:

- Maintain backward compatibility with tauri-driver
- Test on Windows, macOS, and Linux
- Test with multiremote configurations
- Ensure plugin communication works correctly
- Test with various Tauri configuration patterns

### Dioxus Service

When contributing to the Dioxus service or its Rust crates (`wdio-dioxus-bridge`, `wdio-dioxus-embedded-driver`, `wdio-dioxus-driver`):

- Maintain backward compatibility with the `install(config)` bridge API
- Test on Windows, macOS, and Linux (for the `'embedded'` provider)
- Always build the Dioxus fixture app in **debug mode** — the bridge is compiled behind `#[cfg(debug_assertions)]` and will not be present in release builds
- Build the fixture app before running E2E tests:
  ```bash
  cd fixtures/e2e-apps/dioxus
  cargo build
  ```
- Run the Dioxus unit and integration tests:
  ```bash
  pnpm --filter @wdio/dioxus-service test:unit
  pnpm --filter @wdio/dioxus-service test:integration
  ```
- Run the Dioxus E2E tests (requires a built fixture app):
  ```bash
  cd e2e
  pnpm wdio run wdio.dioxus-embedded.conf.ts
  ```
- On Linux, a display server is required. Wrap E2E runs with Xvfb:
  ```bash
  export DISPLAY=:99
  Xvfb :99 -screen 0 1280x800x24 &
  pnpm wdio run wdio.dioxus-embedded.conf.ts
  ```
- The `'external'` provider is Windows-only in v1. Linux support is deferred to v1.1. Do not attempt to test the `'external'` provider on Linux or macOS.
- When changing the bridge crate, also update `packages/dioxus-bridge/docs/release-notes/` as appropriate
- See [bridge setup docs](packages/dioxus-service/docs/plugin-setup.md) for how the bridge integrates with a Dioxus application

### Shared Utilities

When contributing to shared utilities:

- Keep utilities framework-agnostic
- Document extension points clearly
- Consider impact on all services

## Maintenance Policy

This repository does not maintain LTS or backport branches. Only the latest version on `main` receives updates. For details, see [MAINTENANCE.md](./MAINTENANCE.md).

## Release Process

Releases are automated via GitHub Actions and triggered by PR labels.

### Autorelease (Recommended)

When your PR is merged to `main`, the release workflow checks for release labels:

1. Add a scope label to your PR: `scope:electron`, `scope:tauri`, `scope:dioxus`, or `scope:shared`
2. Add a version label: `bump:patch`, `bump:minor`, `bump:major`, or prerelease variants
3. After CI passes and the PR is merged, the release workflow automatically publishes packages

**Preview:** The `release-preview.yml` workflow runs on PRs with release labels to show what will be released.

**Examples:**
- `scope:electron` + `bump:major` → Electron packages at major bump
- `scope:tauri` + `bump:minor` → Tauri packages at minor bump
- `scope:dioxus` + `bump:patch` → Dioxus packages at patch bump
- `scope:shared` + `bump:patch` → Shared packages at patch bump

### Manual Release

For releases without PR labels or for dry runs:

1. Go to Actions → Release in GitHub
2. Click "Run workflow"
3. Select scope, version type, and dry run option
4. Monitor the workflow execution

### Required Labels

| Label | Effect |
|-------|--------|
| `scope:electron` | Release Electron packages |
| `scope:tauri` | Release Tauri packages |
| `scope:dioxus` | Release Dioxus packages |
| `scope:shared` | Release shared packages |
| `bump:patch` | Patch bump |
| `bump:minor` | Minor bump |
| `bump:major` | Major bump |
| `release:prerelease` | Prerelease modifier (use with bump labels) |
| `release:stable` | Stable release modifier (use with bump labels to clean prerelease) |

### Pre-releases

For testing changes before a stable release, use the `release:prerelease` label combined with a bump label:
- `scope:electron` + `bump:major` + `release:prerelease` → Electron packages as major prerelease (e.g., 11.0.0-next.0)
- `scope:dioxus` + `bump:minor` + `release:prerelease` → Dioxus packages as minor prerelease (e.g., 1.1.0-next.0)
- `scope:shared` + `bump:patch` + `release:prerelease` → Shared packages as patch prerelease (e.g., 2.0.0-next.0)

### Release Notes Policy

GitHub release notes are published per **user-installed** package — not per internal dependency. Packages that users only consume transitively are versioned and tagged but skipped from release notes (configured via `publish.githubRelease.skipPackages` in `releasekit.config.json`).

| Framework | Packages with release notes | Skipped (internal only) |
|-----------|-----------------------------|-------------------------|
| Electron  | `@wdio/electron-service` | `@wdio/electron-cdp-bridge`, `@wdio/native-utils`, `@wdio/native-spy`, `@wdio/native-types` |
| Tauri     | `@wdio/tauri-service`, `tauri-plugin`, `tauri-plugin-webdriver` | — |
| Dioxus    | `@wdio/dioxus-service` | `wdio-dioxus-bridge`, `wdio-dioxus-embedded-driver`, `wdio-dioxus-driver` |

Tauri publishes three sets of release notes because `tauri-plugin` and `tauri-plugin-webdriver` are installed and configured directly by users in their Tauri app (Cargo dependency, capability/permission setup), so their breaking changes need their own changelog entries. Electron's and Dioxus's internal packages have no equivalent direct-install surface — users only wire in the bridge crate once and changes are transparent thereafter.

## Getting Help

- **Questions**: Ask on [GitHub Discussions](https://github.com/webdriverio/desktop-mobile/discussions)
- **Bugs**: Report on [GitHub Issues](https://github.com/webdriverio/desktop-mobile/issues)
- **Discord**: Join the [WebdriverIO Discord](https://discord.webdriver.io) for real-time support

## Recognition

Contributors will be:

- Credited in CHANGELOG.md
- Listed in package.json contributors
- Recognized in release notes

Thank you for contributing! 🎉
