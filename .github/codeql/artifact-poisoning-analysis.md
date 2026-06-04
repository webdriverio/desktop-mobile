# CodeQL Actions Artifact Poisoning - False Positive Analysis

**Analysis Date:** 2026-03-01
**CodeQL Rule:** `actions/artifact-poisoning` (github/codeql-action)

## TL;DR

CodeQL flags artifact download + code execution as potentially dangerous. In this repo, artifacts are extracted to a temp directory and only specific build output directories (`dist/`, `dist-js/`, `target/`) are copied to the workspace. Root config files (`package.json`, `pnpm-lock.yaml`, scripts) are never overwritten. The alerts are false positives and excluded in `codeql-config.yml`.

---

## What is Artifact Poisoning?

Artifact poisoning is an attack where a compromised CI pipeline uploads a malicious artifact that, when downloaded by subsequent jobs, can overwrite sensitive files (like `package.json`, `pnpm-lock.yaml`, or scripts) and execute arbitrary code during subsequent build steps.

---

## Summary

CodeQL raised `actions/artifact-poisoning` alerts against debug log steps and artifact download steps in workflow files. After analysis, these were determined to be **false positives** and the alerts are excluded via `codeql-config.yml`.

## Affected Files

| File | Step Name | Alert Type | Detailed Section |
|------|-----------|------------|------------------|
| `.github/workflows/_ci-e2e-electron.reusable.yml` | 🐛 Show Logs on Failure | Script execution | [Script Execution](#alert-script-execution-after-artifact-download) |
| `.github/workflows/_ci-e2e-tauri.reusable.yml` | 🐛 Debug Information | Script execution | [Script Execution](#alert-script-execution-after-artifact-download) |
| `.github/workflows/_ci-e2e-tauri-embedded.reusable.yml` | 🐛 Debug Information | Script execution | [Script Execution](#alert-script-execution-after-artifact-download) |
| `.github/workflows/_ci-e2e-tauri-crabnebula.reusable.yml` | 🐛 Debug Information | Script execution | [Script Execution](#alert-script-execution-after-artifact-download) |
| `.github/workflows/_ci-build-tauri-e2e-app.reusable.yml` | 📦 Install Dependencies | pnpm install | [pnpm install](#alert-pnpm-install-after-artifact-download) |

---

## Custom Download Action

The analysis relies on the custom `download-archive` action located at:
[`.github/workflows/actions/download-archive/action.yml`](../../workflows/actions/download-archive/action.yml)

This action implements the safeguards described below.

---

## Alert: `script execution after artifact download`

### The Alert

CodeQL flagged the pattern:
```yaml
run: pnpm exec tsx e2e/scripts/show-logs.ts
```

The concern: if a malicious artifact were downloaded and extracted to the workspace, it could potentially overwrite `e2e/scripts/show-logs.ts`, causing arbitrary code execution.

### Why This Is A False Positive

The `download-archive` action ([`.github/workflows/actions/download-archive/action.yml`](../../workflows/actions/download-archive/action.yml)) has strict safeguards:

#### 1. Extraction to Temporary Directory

Artifacts are first extracted to `${RUNNER_TEMP}/artifact-extract-{run_id}-{attempt}` - a per-job temp directory outside the workspace.

#### 2. Copying of Specific Directories

The "Extract and Copy Archive" step only copies specific directories to the workspace:

- `**/dist` directories (build output)
- `**/dist-js` directories (build output)
- `**/target` directories (Rust/Tauri build output)

**It never copies `scripts/` directories.**

### Conclusion

Even if a malicious artifact contained a poisoned `e2e/scripts/show-logs.ts` file:
1. The artifact extracts to a temp directory
2. The copy logic only looks for `dist/`, `dist-js/`, and `target/`
3. The `scripts/` directory is never touched

The script at `e2e/scripts/show-logs.ts` can only come from the git checkout, never from an artifact.

---

## Alert: `pnpm install after artifact download`

### The Alert

CodeQL flagged the `pnpm install --frozen-lockfile` step in `_ci-build-tauri-e2e-app.reusable.yml` after the `download-archive` action downloads artifacts.

The concern: if a malicious artifact overwrote `package.json`, `pnpm-lock.yaml`, or `.npmrc`, it could cause arbitrary code execution during install.

### Why This Is A False Positive

The `download-archive` action has multiple safeguards:

#### 1. Extraction to Temporary Directory

Artifacts are extracted to `${RUNNER_TEMP}/artifact-extract-{run_id}-{attempt}` - a per-job temp directory outside the workspace.

#### 2. Copying of Specific Directories

The action only copies these specific directories:
- `**/dist` directories (build output)
- `**/dist-js` directories (build output)
- `**/target` directories (Rust/Tauri build output)

**It never copies root-level files** like `package.json`, `pnpm-lock.yaml`, or `.npmrc`.

#### 3. pnpm Uses Workspace Root Files

`pnpm install` runs from the workspace root, which contains the git checkout. It uses:
- `package.json` from git checkout
- `pnpm-lock.yaml` from git checkout
- `.npmrc` from git checkout

These files are never overwritten by the artifact download.

### Conclusion

Even if a malicious artifact contained poisoned `package.json` or `pnpm-lock.yaml`:
1. The artifact extracts to a temp directory
2. The copy logic only looks for build output directories
3. Root-level config files are never touched

The `pnpm install` command only uses config files from the git checkout, never from artifacts.

---

## CodeQL Configuration

The alerts are excluded via `codeql-config.yml`:

```yaml
queries:
  - exclude:
      id: actions/artifact-poisoning
      comment: False positives - see .github/codeql/artifact-poisoning-analysis.md
```

---

## CodeQL's Limitation

CodeQL's `actions/artifact-poisoning` rule applies a blanket "defense in depth" analysis:
- It sees: "artifacts are downloaded" + "code is executed from workspace"
- It doesn't understand: the custom extraction logic that targets specific directories

This is a reasonable default for CodeQL to apply, but in this codebase with the custom `download-archive` action, the risk is mitigated by design.

---

## Monitoring

If the `download-archive` action is ever modified, re-analyze to ensure safeguards remain in place.
