# Development

## Setup

See the [Monorepo Setup Guide](../../docs/setup.md) for prerequisites, cloning, installing dependencies, building, and common workflows.

## Dependency Management

The project uses a catalog system to manage Electron versions across three catalogs:

| Catalog   | Purpose                    | Example                                   |
| --------- | -------------------------- | ----------------------------------------- |
| `default` | Stable production versions | `electron: "catalog:default"` → `^32.0.1` |
| `next`    | Latest/nightly builds      | `electron-nightly: "catalog:next"`        |
| `minimum` | Lowest supported versions  | `electron: "catalog:minimum"` → `^28.0.0` |

See [Dependency Management](../../docs/setup.md#dependency-management) for catalog switching and update commands.

For the `next` catalog specifically, the update process:
- Fetches the latest `electron-nightly` version from npm
- Compares all available tags (next, beta, alpha, latest) by full semantic version
- Prioritizes cutting-edge tags in order: next > beta > alpha > latest
- Removes the `electron` dependency (only `electron-nightly` is used in this catalog)

## Development Mode

```bash
# Rebuild all packages on changes
pnpm dev

# Rebuild a specific package
pnpm dev --filter "@wdio/native-utils"
```

## Testing

### E2E Tests

```bash
pnpm test:e2e-local
pnpm test:e2e-mac-universal-local
```

Task graphs:

![E2E Task Graph](../.github/assets/e2e-graph.png "E2E Task Graph")
![Mac Universal E2E Task Graph](../.github/assets/e2e-graph-mac-universal.png "Mac Universal E2E Task Graph")

Enable debug output for all namespaces:

```bash
DEBUG=wdio-electron-service:* pnpm test:e2e-local
```

All E2E test applications use [electron-vite](https://electron-vite.org).

### Update E2E Task Graphs

```bash
pnpm graph
```

### Unit Tests

```bash
# All unit tests (from repo root)
pnpm test:unit

# Watch mode (from package directory)
pnpm test:dev
```

## Release

Project maintainers publish releases using GitHub Actions. Releases are driven by PR labels (`track:`, `semver:`, `release:`) and executed via the Release workflow. See [Release Management](./release-management.md) for the full label scheme and workflow.

### Quick Reference

- **Track labels**: `track:main`, `track:feature`, `track:maintenance`
- **Semver labels**: `semver:patch`, `semver:minor`, `semver:major`
- **Timing labels**: `release:next` (include in next release), `release:future` (defer)

### Manual Release

1. Go to Actions → "Manual Release Publish" (or "Manual Pre-Release Publish")
2. Click "Run workflow"
3. Select branch, version increment type, and dry run option

### Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for contribution guidelines, commit format, and PR process.
- **[Help Wanted Issues](https://github.com/webdriverio/desktop-mobile/issues?q=is%3Aissue+is%3Aopen+sort%3Aupdated-desc+label%3Ahelp%3Awanted)**
- **[Beginner Friendly Issues](https://github.com/webdriverio/desktop-mobile/issues?q=is%3Aissue+is%3Aopen+sort%3Aupdated-desc+label%3Ahelp%3Abeginner-friendly)**
