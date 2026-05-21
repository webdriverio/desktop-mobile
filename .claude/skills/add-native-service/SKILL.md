---
name: Add Native Service
description: Process for adding a new framework service (e.g. @wdio/dioxus-service, @wdio/electrobun-service, @wdio/capacitor-service) to this monorepo. Use this skill when the user asks to add support for a new desktop or mobile framework, when extending the supported-frameworks list in ROADMAP.md, or when bootstrapping any new @wdio/<framework>-service package.
---

# Add Native Service

A runbook for bootstrapping a new WebdriverIO service package in this monorepo. Distilled from the Dioxus service implementation (PR1 + PR2 of branch `feat/dioxus-mvp`); will be refined as subsequent services land.

This skill assumes the new service follows the established pattern: a TypeScript service package, optional Rust crate(s) for in-app bridge / driver plumbing, fixtures, E2E specs, and CI gating.

## When to use

- A new framework (Electrobun, Neutralino, Flutter, React Native, Capacitor, etc.) is being added to the supported-frameworks list per `ROADMAP.md`.
- An existing pre-1.0 service is being promoted to its first real package (Phase 0 spike → first MVP).
- You need to validate that a new framework can be automated before committing to a service implementation.

## When NOT to use

- Adding features to an already-shipped service (`@wdio/tauri-service`, `@wdio/electron-service`, `@wdio/dioxus-service`) — those have their own conventions documented in each package's README.
- Pure refactors of `@wdio/native-core` — see `agent-os/specs/<spec>/IMPLEMENTATION_PLAN.md` for the standards extraction process.

## High-level architecture

```
@wdio/native-types       — type-only; framework-specific types + module augmentation
@wdio/native-utils       — generic primitives (logger, Result, config readers)
@wdio/native-spy         — mock framework + per-framework interceptor adapters
@wdio/native-core        — shared launcher infrastructure (PortManager, DriverPool,
                            DriverProcess, BaseLauncher, logCapture skeleton, logWriter,
                            deeplink helpers, logLevel)
@wdio/<framework>-service — your new package
packages/<framework>-bridge — Rust crate (optional, if the app needs in-app plumbing)
packages/<framework>-driver — Rust crate (optional, if external WebDriver proxy needed)
```

Reuse what you can from `@wdio/native-core` (port management, driver lifecycle, log writer); add framework-specific behaviour on top.

## Process

### Phase 0 — Pre-implementation spike

Validate the platform constraints before writing any production code. Spikes are throwaway — they live in `/spike/<service-name>-spike/` (gitignored).

1. Create the spike directory and a minimal app that uses the framework's public API.
2. Identify the **single most consequential unknown** for the service. Examples:
   - Dioxus: "can a third-party crate flip Wry's `set_allows_automation`?"
   - Electrobun: "is there a stable CDP port and what's the discovery convention?"
   - Capacitor: "what WebView context name does Appium see?"
3. Write code that tries to exercise that unknown. If it fails, identify the workaround (upstream patch needed? alternate API? scope reduction?).
4. Write `spike/FINDINGS.md` capturing:
   - The question, the answer, and the citations (file paths, source snippets).
   - The decision tree for the production implementation.
   - Any platform-by-platform variance (often the most important section — see the Dioxus matrix where the same Wry API is a no-op on Win/Mac but blocking on Linux).
5. Apply the findings to the implementation plan: update Risks, Platform Matrix, and Phasing.

The spike is throwaway code — its output is the FINDINGS document, not the source. Don't merge the spike directory.

### Phase 1 — TypeScript service skeleton

Create `packages/<framework>-service/` with:

```
packages/<framework>-service/
├── package.json
├── tsconfig.json
├── vitest.config.ts                    (unit, parallel)
├── vitest.integration.config.ts        (integration, fileParallelism: false)
└── src/
    ├── index.ts                        public exports (default = worker, launcher = launch service)
    ├── launcher.ts                     extends BaseLauncher
    ├── service.ts                      installs browser.<framework>.* surface
    ├── errors.ts                       SevereServiceError helpers
    └── types.ts                        re-exports public types from @wdio/native-types
```

**Conventions:**

- Initial version: `1.0.0-next.0` (pre-release).
- `package.json` must include `@wdio/native-core`, `@wdio/native-spy`, `@wdio/native-types`, `@wdio/native-utils` as workspace deps. Mirror `@wdio/tauri-service`'s package.json structure exactly — exports, scripts, devDependencies, peerDependencies. The build script is `tsx ../../scripts/build-package.ts`.
- `vitest.integration.config.ts` MUST use `fileParallelism: false` + 30s timeout + `setupFiles: ['test/integration/setup.ts']`.
- `tsconfig.json` extends `../../tsconfig.base.json`, output to `./dist`, root `./src`.

**`launcher.ts`:** extend `BaseLauncher` from `@wdio/native-core`. Implement `onPrepare` and `onComplete`. Guard with platform-specific `SevereServiceError` throws when a platform/provider combination is known unsupportable (per spike findings).

**Types in `@wdio/native-types/src/<framework>.ts`:**
- `<Framework>APIs` — bridge-installed window surface
- `<Framework>ExecuteOptions` — per-call execute overrides
- `<Framework>Mock<T,R>` + `<Framework>MockInstance` — mock function shapes (mirror `TauriMock`)
- `<Framework>ServiceAPI` — full `browser.<framework>.*` interface
- `<Framework>ServiceOptions` + `<Framework>ServiceGlobalOptions` — config shapes
- `<Framework>DriverProvider` — `'external' | 'embedded'` union (use `'external'`, NOT `'official'` — the latter is deprecated and only kept as a Tauri alias)
- `<Framework>Capabilities` — capability shape (interface, NOT extending `Capabilities.RequestedStandaloneCapabilities` directly because dynamic members confuse Rollup; intersect with it at the service level if needed)
- `<Framework>BrowserExtension` — adds `<framework>` field to BrowserBase

Then wire into `@wdio/native-types/src/index.ts`:
- `export type { ... } from './<framework>.js';`
- `BrowserExtension extends ... <Framework>BrowserExtension {}`
- `declare global { namespace WebdriverIO { interface Browser extends ... }`, `interface Capabilities { 'wdio:<framework>ServiceOptions'?: ... }`, `interface ServiceOption extends ... <Framework>ServiceGlobalOptions {}`

### Phase 2 — Rust crates (if needed)

Two patterns:

**Driver crate** (e.g. `packages/<framework>-driver/` → `wdio-<framework>-driver`): forked from `tauri-driver` if the framework uses Wry. ~200 LOC delta:
- Rename crate + binary to `wdio-<framework>-driver` (the `wdio-` prefix leaves the unprefixed namespace free for the framework's project).
- Capability namespace: `"<framework>:options"` (matches your TS `<framework>:options` capability key).
- Env var: `<FRAMEWORK>_WEBVIEW_AUTOMATION` (and drop the legacy `TAURI_AUTOMATION` form).
- Document the upstream-sync policy in the crate's README.

**Bridge crate** (e.g. `packages/<framework>-bridge/` → `wdio-<framework>-bridge`): new code. v1 minimum slice is just `automation.rs` (reads `<FRAMEWORK>_WEBVIEW_AUTOMATION`, logs state). Full IPC (`wdio://` custom protocol + invoke command bus + log forwarder + guest-js) is Phase 3 work, not Phase 2.

**Cargo conventions:**
- Edition `"2021"`, rust-version `"1.77.2"` (matches tauri-driver).
- License `Apache-2.0 OR MIT`.
- Initial version `1.0.0-rc.0`.
- `with-bridge` feature flag (default off) so release builds can compile out the crate.

**Gitignore at repo root:**
```
packages/*/target/
packages/*/Cargo.lock
```

(Matches existing tauri-plugin convention — Cargo.lock for these crates is not committed.)

### Phase 3 — Tests

**Conventions:**
- Use `it('should ...')` throughout. Never `it('does X', ...)` or `it('returns Y', ...)`. Tauri's existing suite is the reference.
- Test files: `test/<module>.spec.ts` for unit, `test/integration/<module>.integration.spec.ts` for integration.
- Mock at the `@wdio/native-core` boundary, not at local module boundaries. If a service module is a thin wrapper around core, the test should `vi.mock('@wdio/native-core', ...)` with a Map-backed in-memory fake — see `packages/tauri-service/test/driverPool.spec.ts` for the reference pattern.
- Rust unit tests: inline `#[cfg(test)] mod tests` blocks. Use `should_*` function names.

**Minimum spec inventory at Phase 1 commit:**
- `test/index.spec.ts` — public export shape
- `test/errors.spec.ts` — error helpers
- `test/launcher.spec.ts` — platform × provider matrix (especially any SevereServiceError throws)

Coverage target: ≥80% statement coverage per `AGENTS.md`. Thin-wrapper packages can declare an exception in `vitest.config.ts` with a comment explaining why.

### Phase 4 — CI gates

In `.github/workflows/_ci-detect-changes.reusable.yml`:

1. Add `run_<framework>` to the outputs declarations + computation.
2. Add filters under `paths-filter`:
   - `<framework>_service`: `packages/<framework>-service/**`, plus any Rust crate paths.
   - `e2e_<framework>`: `e2e/test/<framework>/**`, `e2e/wdio.<framework>.conf.ts`, etc.
   - `fixtures_<framework>`: `fixtures/e2e-apps/<framework>/**`, `fixtures/package-tests/<framework>-app/**`.
3. **Extend the `shared` filter** to include any new packages added under `packages/native-*` (e.g., `packages/native-spy/**`, `packages/native-core/**` — these are easy to forget and were latent CI gaps before Dioxus).
4. Add `RUN_<FRAMEWORK>` to the lint-only gate.

In `.github/workflows/ci.yml`: add `<framework>`-gated jobs mirroring Tauri's set, conditioned on `needs.detect-changes.outputs.run_<framework> == 'true'`.

New reusable workflows (clone from Tauri equivalents):
- `_ci-build-<framework>-apps.reusable.yml`
- `_ci-build-<framework>-e2e-app.reusable.yml`
- `_ci-build-<framework>-package-app.reusable.yml`
- `_ci-e2e-<framework>-all-providers.reusable.yml`

Extend `_ci-package.reusable.yml` and `_ci-package-docker.reusable.yml` to accept `<framework>` in the service matrix.

### Phase 5 — Fixtures, E2E specs, docs, release pipeline

This phase is large and is broken out per the standard 4-PR split (see Plan / PR split below). At the very least, before merging the MVP:

- `fixtures/e2e-apps/<framework>/` — minimal app demonstrating execute + mock + multi-window.
- `e2e/test/<framework>/{api,application,execute-advanced,execute-data-types,logging,logging.external,mocking,window}.spec.ts` — core E2E set, mirroring `e2e/test/tauri/`.
- `e2e/wdio.<framework>.conf.ts` (provider `'external'`) + `e2e/wdio.<framework>-embedded.conf.ts` (provider `'embedded'`).
- `packages/<framework>-service/README.md` + `docs/` set (quick-start, configuration, api-reference, usage-examples, plugin-setup, platform-support, troubleshooting, release-notes/v1.0.0.md).
- Each Rust crate gets its own README.
- Root `README.md`, `ROADMAP.md`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `docs/*.md` updates.
- Release pipeline: update `.github/workflows/release.yml` + `_release.reusable.yml` for npm publish (`@wdio/<framework>-service`, `@wdio/<framework>-bridge`) and crates.io publish (`wdio-<framework>-driver`, `wdio-<framework>-bridge`, `wdio-<framework>-embedded-driver`).

## Naming conventions

| What | Convention | Example |
|---|---|---|
| npm service package | `@wdio/<framework>-service` | `@wdio/dioxus-service` |
| npm bridge JS bundle | `@wdio/<framework>-bridge` (no `-js` suffix) | `@wdio/dioxus-bridge` |
| Rust bridge crate | `wdio-<framework>-bridge` | `wdio-dioxus-bridge` |
| Rust driver crate | `wdio-<framework>-driver` (NOT `<framework>-driver`) | `wdio-dioxus-driver` |
| Rust embedded crate | `wdio-<framework>-embedded-driver` | `wdio-dioxus-embedded-driver` |
| Capability key | `<framework>:options` | `dioxus:options` |
| WDIO service options key | `wdio:<framework>ServiceOptions` | `wdio:dioxusServiceOptions` |
| Window namespace | `window.__WDIO_<FRAMEWORK>__` | `window.__WDIO_DIOXUS__` |
| Automation env var | `<FRAMEWORK>_WEBVIEW_AUTOMATION` | `DIOXUS_WEBVIEW_AUTOMATION` |
| Browser API surface | `browser.<framework>.*` | `browser.dioxus.execute(...)` |

**Why `wdio-` prefix on Rust crates:** Leaves the unprefixed namespace (e.g. `dioxus-driver`) free for the framework's own project, which may want to use it for their official tooling.

**Provider names:** Use `'external'` and `'embedded'`. `'official'` is a deprecated Tauri alias only — don't introduce it on new services.

## Plan / PR split

For a service this size, default to a 4-PR stacked split:

| PR | Branch (off main) | Scope |
|---|---|---|
| **PR1: Foundation** | `feat/<service>-foundation` | Any `@wdio/native-core` extractions needed; deprecation aliases on existing services. |
| **PR2: MVP** | `feat/<service>-mvp` (off PR1) | TS service skeleton, Rust crate skeletons, basic execute + mock, minimum CI. |
| **PR3: Feature Complete** | `feat/<service>-feature-complete` (off PR2) | Multi-window, deeplink, embedded provider, browser mode, macOS, visual testing. |
| **PR4: Ship** | `feat/<service>-ship` (off PR3) | Package-test fixture, full doc set, complete CI, release pipeline. |

Each PR must have green tests on all three suites (`@wdio/<framework>-service`, `@wdio/tauri-service`, `@wdio/electron-service`) plus any Rust `cargo test`. No regressions, ever.

## Common gotchas

1. **Spike before commit.** The Dioxus spike revealed Linux `'external'` was blocked by an upstream Dioxus API gap. Doing the spike first scoped v1 to Windows-only `'external'` rather than blocking the whole release on an external dependency. Always run a Phase 0 spike.

2. **Don't extract speculatively.** During PR1, the Dioxus plan called for extracting `logForwarder` + `logParser` into `@wdio/native-core`. The audit revealed those are too framework-specific to unify (Tauri text-line vs Electron CDP events). Only `shouldLog` was genuinely shared. Audit before extracting; extract only what's actually duplicated bit-for-bit.

3. **Mock at the right boundary.** When a service module is a thin wrapper around `@wdio/native-core`, tests must mock at the core boundary (`vi.mock('@wdio/native-core', ...)`) not the local module. Otherwise the mock won't reach the actual spawn/IO call. Pattern: Map-backed in-memory fake. See `packages/tauri-service/test/driverPool.spec.ts`.

4. **`Capabilities.RequestedStandaloneCapabilities` cannot be extended.** Rollup's TS plugin can't extend dynamic-member interfaces. Declare `<Framework>Capabilities` as a plain interface and intersect with `Capabilities.RequestedStandaloneCapabilities` at the service-level type aliases (see `TauriServiceRequestedStandaloneCapabilities` for the pattern).

5. **Async log writer close.** Core's `LogWriter.close()` is async (calls `stream.end(callback)` and waits for flush). When porting Tauri-style synchronous `close()` callers, mock `end: vi.fn((cb?) => cb?.())` so the underlying promise resolves in tests, and remember to `await` close calls.

6. **`shared` paths-filter gaps.** `packages/native-spy/**` and `packages/native-core/**` need to be in the `shared` filter of `_ci-detect-changes.reusable.yml`. Easy to miss; resulted in latent CI gaps before Dioxus PR1.

7. **Gitignore Rust build artefacts.** `packages/*/target/` and `packages/*/Cargo.lock` go in the root `.gitignore`. Forgetting this can result in a 42 MB accidental commit of build artifacts (yes, this happened during Dioxus PR2).

8. **Rust env-var tests use `unsafe { std::env::set_var(...) }`** in 2024 edition. Tests should be in a single `mod tests` to avoid parallel-test interference, or clean up afterwards.

## Verification checklist (per PR)

Before merging each PR:

- [ ] `pnpm --filter @wdio/<framework>-service typecheck` clean
- [ ] `pnpm --filter @wdio/<framework>-service test:unit` green (all `it('should ...')`)
- [ ] `pnpm --filter @wdio/<framework>-service test:coverage` ≥ 80%
- [ ] `pnpm --filter @wdio/tauri-service test:unit` no regressions
- [ ] `pnpm --filter @wdio/electron-service test:unit` no regressions
- [ ] `pnpm --filter @wdio/native-core test:unit` no regressions
- [ ] `cargo check` clean for each new Rust crate
- [ ] `cargo test` green for each new Rust crate
- [ ] No `packages/*/target/` files staged

## Reference implementations

- **Dioxus service** — `packages/dioxus-service/`, `packages/dioxus-bridge/`, `packages/dioxus-driver/`. The reference for this skill.
- **Tauri service** — `packages/tauri-service/`. The mature, fully-shipped reference (multi-window, multiremote, browser mode, all three providers).
- **Electron service** — `packages/electron-service/`. The CDP-based alternative architecture; useful when the framework doesn't use Wry.
- **Plan files** — `~/.claude/plans/<plan-name>.md`. Always start with a plan that captures Strategy decisions, Package layout, Phasing, Risks, and Open decisions.
- **Spike findings** — `spike/FINDINGS.md`. Captures the Phase 0 spike for whatever question is being investigated.

## Versioning over time

This skill captures the process as of PR2 of the Dioxus service. Update it as later phases land:

- After PR2 MVP: add specifics about bridge IPC (invoke.rs, log_bridge.rs) and guest-js bundle layout.
- After PR3 Feature Complete: add specifics about embedded WebDriver crates and macOS quirks.
- After PR4 Ship: add the full release / publishing checklist with concrete `gh release` + `cargo publish` flow.
- Promote skill from `.claude/skills/add-native-service/SKILL.md` to a markdown reference in `agent-os/standards/` once a third service has gone through the process and the patterns are settled.
