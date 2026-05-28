# Phases 4 & 5 — CI gates and release pipeline

Concrete wiring for getting a new service gated in CI and published. Grounded in the shipped Dioxus setup.

## CI gates

### `_ci-detect-changes.reusable.yml`

This computes per-framework `run_*` flags from path filters so CI only runs affected jobs.

1. Add output `run_<framework>` to the `workflow_call.outputs` block **and** the job `outputs` block (`run_<framework>: ${{ steps.determine.outputs.run_<framework> || 'false' }}`).
2. Add `paths-filter` entries:
   - `<framework>_service`: `packages/<framework>-service/**` + any Rust crate paths (`packages/<framework>-bridge/**`, `-driver/**`, `-embedded-driver/**`).
   - `e2e_<framework>`: `e2e/test/<framework>/**`, `e2e/wdio.<framework>.conf.ts` (+ `wdio.<framework>-embedded.conf.ts`).
   - `fixtures_<framework>`: `fixtures/e2e-apps/<framework>/**`, `fixtures/package-tests/<framework>-app/**`.
   - `infra_<framework>`: the per-framework reusable workflow files (see below).
3. **Extend the `shared` filter** to include every `packages/native-*` (`native-types`, `native-utils`, `native-core`, `native-spy`). Missing one is a latent CI gap (see the `shared` paths-filter gotcha in SKILL.md → Common gotchas).
4. In the `determine` step compute `run_<framework> = <framework>_service || e2e_<framework> || fixtures_<framework> || shared || infra || infra_<framework>`, and set it under the "run everything" branch (e.g. when CI infra itself changes).

### `ci.yml`

Add `<framework>`-gated jobs mirroring the sibling framework's set, each guarded:

```yaml
if: needs.detect-changes.outputs.run_<framework> == 'true' && needs.detect-changes.outputs.run_lint_only != 'true'
```

Dioxus's shipped jobs (per-OS matrix) are the template: `build-<framework>-crates-*` (Wry only), `build-<framework>-e2e-app-{linux,windows,macos-arm}`, `build-<framework>-package-app-*`, and the all-providers E2E job. Note v1 scope can be OS-limited (Dioxus crates build Linux-only initially).

### Reusable workflows to clone

From the Dioxus equivalents (names matter — match them):

- `_ci-build-<framework>-crates.reusable.yml` — **Wry only**; builds + `cargo test`s the Rust crates.
- `_ci-build-<framework>-e2e-app.reusable.yml` — builds the E2E fixture app.
- `_ci-build-<framework>-package-app.reusable.yml` — builds the package-test fixture.
- `_ci-e2e-<framework>-all-providers.reusable.yml` — runs E2E across providers.

Extend `_ci-package.reusable.yml` and `_ci-package-docker.reusable.yml` to accept `<framework>` in the service matrix. (CDP services skip the `-crates` workflow entirely — no Rust to build.)

## Release pipeline

Releases run through **ReleaseKit** (`goosewobbler/releasekit`), driven by a **scope**. Two entry points in `release.yml`: auto (on successful CI push to `main`, gated by a ReleaseKit `gate` job) and manual (`workflow_dispatch` with `scope` / `bump` / `release_type` / `dry_run`).

To add a framework:

1. **`release.yml`** — add `<framework>` to the `scope` choice list (`workflow_dispatch.inputs.scope.options`).
2. **`_release.reusable.yml`** — three edits, all keyed on `scope`:
   - **Compute target packages** (`steps.targets`): add a `case` mapping `<framework>` to its comma-separated publish set. CDP example: `@wdio/<framework>-service,@wdio/<framework>-cdp-bridge`. Wry example (Dioxus): `@wdio/dioxus-service,@wdio/dioxus-bridge,wdio-dioxus-bridge,wdio-dioxus-embedded-driver,wdio-dioxus-driver`.
   - **Build packages** (`steps` "Build packages"): add a `case` running the right `turbo run build --filter=...` set; Wry adds `pnpm turbo run build:rust --filter='@wdio/<framework>-bridge'`.
   - **Rust setup + GTK libs**: the "Setup Rust" and "Install GTK development libraries" steps run `if: contains(inputs.scope, 'tauri') || contains(inputs.scope, 'dioxus')`. Add `|| contains(inputs.scope, '<framework>')` for a new Wry framework. CDP frameworks need neither.
3. Rust crates publish to crates.io via `CARGO_REGISTRY_TOKEN` (from `crates_io_token` secret); npm packages publish with provenance. Both already wired in the `Run ReleaseKit` step — listing the crate in the target set is enough.

### Per-package release notes

Each shipped service keeps `docs/release-notes/v1.0.0.md`; Wry crates keep `docs/release-notes/` too (e.g. `dioxus-bridge/docs/release-notes/v1.0.0.md`). Add the v1 note before the Ship PR.
