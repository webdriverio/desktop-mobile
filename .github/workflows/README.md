# GitHub Actions Workflows

This directory contains the CI/CD workflows for the WebdriverIO Desktop & Mobile Testing repository.

## Release Workflow

The `release.yml` workflow handles both manual and automated releases using the reusable `_release.reusable.yml` workflow.

### Scopes

- **`electron`** - Releases `@wdio/electron-service`
- **`tauri`** - Releases `@wdio/tauri-service`, `@wdio/tauri-plugin` (NPM + crates.io)
- **`shared`** - Releases `@wdio/native-types`, `@wdio/native-utils` independently

### Version Types

- `patch`, `minor`, `major` - Stable releases
- `prepatch`, `preminor`, `premajor`, `prerelease` - Pre-releases

### Manual Trigger

1. Go to Actions → Release
2. Click "Run workflow"
3. Select scope, version type, and dry run option
4. For dry runs, set `dry_run: true` to preview without publishing

### Autorelease

Automated releases trigger when CI completes on `main` with release labels on merged PRs. The `release-preview.yml` workflow runs on PRs to show what will be released.

**Release Labels:**

- **Scope labels** (prefix `scope:`):
  - `scope:electron` - Release Electron packages
  - `scope:tauri` - Release Tauri packages

- **Bump labels** (prefix `bump:`):
  - `bump:patch`, `bump:minor`, `bump:major`

- **Release type labels** (prefix `release:`):
  - `release:prerelease` - Use with bump labels for prerelease versions
  - `release:stable` - Use with bump labels to clean prerelease to stable

**Examples:**
- `scope:electron` + `bump:major` → Electron packages at major bump
- `scope:tauri` + `bump:minor` → Tauri packages at minor bump

**Default behavior:** If only scope is specified, uses `minor` bump.

**Preview workflow:** When a PR has release labels, the `release-preview.yml` workflow shows what packages would be released and their new versions.

## Dry Runs

Always run with `dry_run: true` first to verify:
- Correct packages will be released
- Version numbers are as expected
- Changelog entries are correct

## Required Secrets

| Secret | Required | Purpose |
|--------|----------|---------|
| `DEPLOY_KEY` | All releases | SSH key for pushing tags/commits |
| `CRATES_IO_TOKEN` | Tauri releases | Publishing Rust crates |
| `OLLAMA_API_KEY` | Optional | LLM-enhanced release notes |

## Architecture

```
release.yml
    ├── gate (autorelease only)
    └── _release.reusable.yml
            ├── Checkout (SSH or read-only)
            ├── Setup Node.js/pnpm
            ├── Install dependencies
            ├── Setup Rust (tauri scope only)
            ├── Install GTK (tauri scope only)
            ├── Build packages (by scope)
            ├── Configure Git
            ├── Run releasekit (version + publish)
            └── Summary (outputs results)
```

### Branch Targeting

The `--branch` flag is passed to releasekit to ensure pushes go to the correct branch, not the hardcoded `main` in `releasekit.config.json`.

### LLM Enhancement

Release notes can be enhanced with LLM (Ollama). If `OLLAMA_API_KEY` is not set or authentication fails (401/403), the workflow falls back to raw changelog entries gracefully.

## Other Workflows

- **`ci.yml`** - Build, test, lint
- **`release-preview.yml`** - Preview release outcome on PRs with release labels
