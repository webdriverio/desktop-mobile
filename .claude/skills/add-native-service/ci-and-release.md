# Phases 4 & 5 — CI gates and release pipeline

Concrete wiring for getting a new service gated in CI and published. Grounded in the shipped Dioxus setup.

## CI gates

### Change detection — convention-driven, no per-framework edits

`_ci-detect-changes.reusable.yml` delegates classification to `scripts/detect-changes.ts`,
which **discovers services from `packages/*-service` and classifies changed files by naming
convention**. A new framework is detected automatically — there is nothing to add to the
detect workflow — PROVIDED the framework follows the conventions:

- Packages: `packages/<framework>-service`, `packages/<framework>-cdp-bridge`, crate dirs
  `packages/<framework>-{bridge,driver,embedded-driver}` (any `<framework>-*` prefix works).
- E2E: `e2e/test/<framework>/**`, `e2e/wdio.<framework>*.conf.ts`.
- Fixtures: `fixtures/e2e-apps/<framework>*/**`, `fixtures/package-tests/<framework>*/**`.
- Per-framework workflow files carry the framework name as a hyphen-delimited token
  (`_ci-build-<framework>-e2e-app.reusable.yml`) — an unnamed workflow classifies as
  shared infra and force-runs everything.

Three things still need doing per framework:

1. **ci.yml consumption**: gate the new jobs on `fromJSON(needs.detect-changes.outputs.runs).<framework>`
   (the JSON `runs` output picks up new services automatically). Adding a static
   `run_<framework>` output to the reusable is optional sugar for readability.
2. **Add classifier test cases**: extend `test/scripts/detect-changes.spec.ts` with the new
   framework's paths (service src → framework; its README alone → lint-only; an unrelated
   service's file → false). Run with `pnpm test:scripts` (CI runs this in the lint job). (React
   Native's cases are already in — including the longest-prefix `react` vs `react-native` guard;
   this step recurs for each *new* framework, e.g. Flutter.)
3. **If the framework adds shared packages** (`packages/native-*`), nothing to do — the
   `native-*`/`bundler` prefixes classify as shared automatically.

Files the classifier can't place inside `packages/`, `e2e/`, `fixtures/`, `.github/workflows/`,
or `scripts/` deliberately **run everything** — convention drift fails loud (the step summary
lists them), never silent.

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

### Mobile CI — per-platform, not per-provider

Mobile has no driver providers; instead it splits **per platform** (the per-platform PR split in SKILL.md). Clone the React Native equivalents rather than the desktop `-all-providers` shape:

- **`_ci-e2e-<framework>.reusable.yml`** (Android, `ubuntu-latest`) — a **single combined job** (the JS bundle couples to the APK at runtime, so build and run can't split cleanly like desktop): free disk **without** removing `/usr/local/lib/android` → enable KVM → setup → download the prebuilt package dist artifact → JDK 17 → scaffold the native project at a pinned framework version + overlay the fixture source + build the debug APK → **idempotent** Appium UiAutomator2 install (`driver list --installed | grep` guard) → `reactivecircus/android-emulator-runner` (pinned to a full SHA — it gets `secrets: inherit`; API 35, x86_64, KVM, `-gpu swiftshader_indirect`) running `adb reverse tcp:8081` + Metro start + `wait-on tcp:8081` + the specs.
- **`_ci-e2e-<framework>-ios.reusable.yml`** (iOS, `macos-latest`) — **two stages**, because a heavy `xcodebuild` on the same runner as the Appium session starves appium-xcuitest's SDK probe / drops `POST /session`:
  - **Build job**: scaffold + (CocoaPods for iOS) → `xcodebuild -sdk iphonesimulator -derivedDataPath build CODE_SIGNING_ALLOWED=NO` → **tar** the `.app` (preserves the sim bundle's symlinks/exec bits) → upload, named keyed by **`run_id` only** (so a `gh run rerun --failed`, which doesn't rebuild, still finds it).
  - **E2E job** (fresh runner): download + unpack the `.app` → re-scaffold the JS for Metro (no native build) → warm the Xcode toolchain (`xcrun --show-sdk-version`) → boot the sim → idempotent XCUITest install → **pre-build WebDriverAgent into an explicit `RN_WDA_DD` derivedDataPath** (the conf reads it via `appium:derivedDataPath` + `usePrebuiltWDA`) → Metro start + **pre-bundle** (`curl …/index.bundle`, avoids the "Bundling…" overlay race) → specs.
- **`ci.yml`** gates both on `fromJSON(needs.detect-changes.outputs.runs)['<framework>']`, and folds each leg into the single aggregated "CI Status" check (gated required from the first PR — branch protection needn't change).
- **Architecture matrix (framework-specific).** RN runs each leg under an `arch: [old, new]` matrix — Paper (`newArchEnabled=false` / `RCT_NEW_ARCH_ENABLED=0`) and Fabric/bridgeless (`=true`/`=1`), **both required gates**. Under Fabric the view tree + the Hermes inspector register ~12–24s **later** than Paper; the spec's app-ready `before` gate and the service's Hermes connect-retry budget absorb that, so both archs drive the **same** fixture. This dual-arch split is **specific to React Native** — Flutter has no Paper/Fabric equivalent, so don't replicate the `arch` matrix blindly; a framework's own build-time toggle (if any) is decided in *its* spike.
- **Appium driver install is idempotent**: `appium` exits 1 if the driver is already registered in `APPIUM_HOME`, so guard every install behind a `driver list --installed` grep.
- **Generalising beyond RN — what's RN-specific vs the invariant.** The *shape* is general (per-platform legs; build a **debug/instrumented** app; idempotent driver install; gated via "CI Status"). The RN specifics are **not**: the Metro bundle server, `adb reverse tcp:8081`, and the `index.bundle` pre-bundle are RN's JS-debug-server wiring. A framework with a different JS-realm channel substitutes its own — Flutter has **no Metro** (Dart compiles into the app, so no bundle-server step and no pre-bundle), but its execute/find channel still needs the **Dart VM Service port** discovered and (on Android) forwarded (`adb forward` the observatory port, not 8081). The invariant: *build debug, then expose the framework's debug/eval port to the host*; the port and the bundler step are per-framework, decided in its spike.

## Release pipeline

Releases run through **ReleaseKit** (`goosewobbler/releasekit`), driven by a **scope**. Two entry points in `release.yml`: auto (on successful CI push to `main`, gated by a ReleaseKit `gate` job) and manual (`workflow_dispatch` with `scope` / `bump` / `release_type` / `dry_run`).

To add a framework:

1. **`release.yml`** — add `<framework>` to the `scope` choice list (`workflow_dispatch.inputs.scope.options`).
2. **`_release.reusable.yml`** — three edits, all keyed on `scope`:
   - **Compute target packages** (`steps.targets`): add a `case` mapping `<framework>` to its comma-separated publish set. CDP example (Electron's legacy shape, with its own bridge): `@wdio/<framework>-service,@wdio/<framework>-cdp-bridge` — but a **new** CDP service reuses the shared `@wdio/native-cdp-bridge` and is therefore service-only, like the mobile example below. Wry example (Dioxus): `@wdio/dioxus-service,@wdio/dioxus-bridge,wdio-dioxus-bridge,wdio-dioxus-embedded-driver,wdio-dioxus-driver`. **Mobile example: `@wdio/<framework>-service` only** — it reuses the shared `@wdio/native-cdp-bridge` (released on its own scope) and ships no Rust crates.
   - **Build packages** (`steps` "Build packages"): add a `case` running the right `turbo run build --filter=...` set; Wry adds `pnpm turbo run build:rust --filter='@wdio/<framework>-bridge'`. Mobile is a plain `turbo run build --filter=@wdio/<framework>-service` (no `build:rust`).
   - **Rust setup + GTK libs**: the "Setup Rust" and "Install GTK development libraries" steps run `if: contains(inputs.scope, 'tauri') || contains(inputs.scope, 'dioxus')`. Add `|| contains(inputs.scope, '<framework>')` for a new Wry framework. **CDP and mobile frameworks need neither.**
3. Rust crates publish to crates.io via `CARGO_REGISTRY_TOKEN` (from `crates_io_token` secret); npm packages publish with provenance. Both already wired in the `Run ReleaseKit` step — listing the crate in the target set is enough.

### Release notes — generated by ReleaseKit, do NOT hand-author

ReleaseKit generates the release notes + `CHANGELOG.md` as part of the release (configured under
`notes` in `releasekit.config.json`; LLM-enhanced when an Ollama key is present). The
`docs/release-notes/<version>.md` files in the repo (e.g. `dioxus-service/docs/release-notes/v1.0.0.md`)
are **generated artifacts committed by a release**, not pre-Ship inputs — so do **not** hand-author a
`docs/release-notes/<version>.md` for a new service; it appears when the release runs. Listing the
package in the `_release.reusable.yml` target set is enough. Supported-subset/limitations prose is
hand-authored in the service README + `docs/` instead.

## Package-tests are ESM-only for mobile

The package-test fixture installs the published (or packed) service and composes a real WDIO config.
For mobile that config must list `services: ['appium', '<framework>']` — and `@wdio/appium-service`
+ WDIO v9 core are **ESM-only** (import-only exports, no `require`), so a **CJS** mobile config can't
compose those services at all. Ship **one ESM package-test fixture**, no CJS variant. (This is the
*fixture/consumer* config — the service package itself still builds dual ESM/CJS via
`build-package.ts` like every package; only the package-*test* drops CJS. Electron's CJS+ESM
package-test split is Electron-app-specific and doesn't transfer.) Mobile package-tests can be a
**deferred follow-up** — React Native's isn't shipped yet; when deferred, file a tracked GitHub issue
per the follow-up doctrine rather than leaving it implicit.
