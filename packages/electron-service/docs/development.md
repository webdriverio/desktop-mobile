# Development

## Setup

See the [Monorepo Setup Guide](../../../docs/setup.md) for prerequisites, cloning, installing dependencies, building, and common workflows.

## Dependency Management

The project uses a catalog system to manage Electron versions across three catalogs:

| Catalog   | Purpose                    | Example                                   |
| --------- | -------------------------- | ----------------------------------------- |
| `default` | Stable production versions | `electron: "catalog:default"` → `^32.0.1` |
| `next`    | Latest/nightly builds      | `electron-nightly: "catalog:next"`        |
| `minimum` | Lowest supported versions  | `electron: "catalog:minimum"` → `^28.0.0` |

See [Dependency Management](../../../docs/setup.md#dependency-management) for catalog switching and update commands.

For the `next` catalog:

- `pnpm catalog:update --next` pins `electron-nightly` to its newest nightly that's old enough for pnpm's `minimumReleaseAge`
- `pnpm catalog:next` replaces each package's `electron` dependency with `electron-nightly`, and switching to another catalog puts `electron` back

## Development Mode

```bash
# Rebuild all packages on changes
pnpm dev

# Rebuild a specific package
pnpm dev --filter "@wdio/native-utils"
```

## Testing

### E2E Tests

Build the E2E apps first; see the [E2E Testing Guide](../../../docs/e2e-testing.md). Then run a suite from the repo root:

```bash
pnpm e2e:electron-builder
pnpm e2e:electron-forge
pnpm e2e:electron-script
```

Enable debug output for all namespaces:

```bash
DEBUG=wdio-electron-service:* pnpm e2e:electron-builder
```

All E2E test applications use [electron-vite](https://electron-vite.org).

### Unit Tests

```bash
# All unit tests (from repo root)
pnpm test:unit

# Watch mode (from package directory)
pnpm test:dev
```

## Release

Releases are versioned from conventional commits on `main` and published from a standing release PR. See [Release Process](../../../CONTRIBUTING.md#release-process).

## Contributing

See [CONTRIBUTING.md](../../../CONTRIBUTING.md) for contribution guidelines, commit format, and PR process.

- **[Help Wanted Issues](https://github.com/webdriverio/desktop-mobile/issues?q=is%3Aissue+is%3Aopen+sort%3Aupdated-desc+label%3Ahelp%3Awanted)**
- **[Beginner Friendly Issues](https://github.com/webdriverio/desktop-mobile/issues?q=is%3Aissue+is%3Aopen+sort%3Aupdated-desc+label%3Ahelp%3Abeginner-friendly)**
