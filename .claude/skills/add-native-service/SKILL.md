---
name: Add Native Service
description: Runbook for adding a new native-app testing service to this WebdriverIO monorepo. Covers every shipped desktop architecture — Electron's CDP attach, Tauri's external WebDriver driver, and Dioxus's in-process embedded driver + bridge crate — and is abstracted to apply to any new desktop framework. Use this skill when asked to add support for a new desktop framework, to bootstrap a new @wdio/<framework>-service package, to extend the supported-frameworks list in ROADMAP.md, or when shipping/refactoring any of the existing electron, tauri, or dioxus services along the shared pattern. (Mobile frameworks are expected to introduce new patterns warranting a future revision.)
---

# Add Native Service

A runbook for bootstrapping a new WebdriverIO service package in this monorepo. It abstracts over the **three architectures already shipped here** so the same process can ship any of them:

- **Electron** (`@wdio/electron-service`) — CDP attach, no driver process, no Rust.
- **Tauri** (`@wdio/tauri-service`) — Wry webview, external WebDriver driver + Tauri plugin crate.
- **Dioxus** (`@wdio/dioxus-service`) — Wry webview, in-process embedded WebDriver server + bridge crate.

If you follow this skill against any of those frameworks you should land in the same place the shipped package already is, and the same process bootstraps the next desktop framework. See `ROADMAP.md` for what's planned.

The single most important step is **Step 0**: identify which architecture archetype your framework falls into. It decides whether Phase 2 builds Rust crates, attaches over CDP, or forks a driver — and which existing service you clone.

**Scope:** this skill currently targets **desktop** frameworks. The first mobile service is expected to introduce new patterns (device/emulator management, Appium-style webview contexts) that will warrant a major revision — don't assume this runbook covers mobile yet.

## When to use

- A new desktop framework is being added per `ROADMAP.md`.
- An existing pre-1.0 service is being promoted from a Phase 0 spike to its first MVP package.
- You're validating that a framework can be automated before committing to a service implementation.
- You're refactoring one of the shipped services and want to keep it aligned with the shared pattern.

## When NOT to use

- Adding a feature to an already-shipped service — those have package-local conventions in each `README.md` / `docs/`.
- Pure refactors of `@wdio/native-core` — see the relevant `agent-os/specs/<spec>/` plan.

## Step 0 — Identify the integration archetype

Every framework here resolves to a point on two axes. Decide both before writing code (confirm them in the Phase 0 spike).

**Axis 1 — Transport: how does the test process drive the app?**

| | Signal | Path | Clone |
|---|---|---|---|
| **CDP attach** | Runtime exposes a Chrome DevTools Protocol endpoint (Chromium-based runtimes, e.g. Electron) | Attach a WebSocket CDP client. No driver process, no in-app Rust. | `@wdio/electron-service` + `@wdio/electron-cdp-bridge` |
| **WebDriver** | App embeds a system webview via **Wry** (Tauri, Dioxus) or another WebView host with no CDP | Drive a W3C WebDriver endpoint. Needs in-app plumbing + a driver. | `@wdio/tauri-service` or `@wdio/dioxus-service` |

**Axis 2 — (WebDriver only) Driver model: where does the WebDriver server live?**

| | Description | Reference |
|---|---|---|
| **external** | A driver subprocess proxies WebDriver to the platform webview driver (`msedgedriver` / `webkit2gtk-driver`). Driver is a fork of `tauri-driver`. **Not available on macOS** for any Wry service. | Tauri (Linux/Windows), Dioxus (Windows only) |
| **embedded** | An in-process W3C WebDriver HTTP server compiled into the app. No external driver to install — works on all 3 OSes. Delivered as a **plugin the app registers** (Tauri → `tauri-plugin-wdio-webdriver`) or a **crate wired via the bridge** (Dioxus → `wdio-dioxus-embedded-driver`). | Tauri + Dioxus (Dioxus default) |

**Both shipped Wry services support both providers** (Tauri also offers a CrabNebula provider). Pick `'embedded'` as the default if you can — it removes per-OS driver installation. How the embedded server is delivered follows Axis 2b: a plugin where the framework has a plugin system, a bridge-wired crate where it doesn't.

**Axis 2b — (WebDriver only) In-app plumbing: how do test hooks get into the app?**

| Framework has… | Use | Example |
|---|---|---|
| a plugin system | **plugin crate(s)** registered by the app — note these are *separate concerns*: one plugin for execute/mock IPC, and (for the embedded provider) a **second** plugin for the embedded WebDriver server | Tauri → `tauri-plugin-wdio` (execute/mock) **+** `tauri-plugin-wdio-webdriver` (embedded server) |
| no plugin system | a **bridge crate** that injects guest-js via the Config's custom-head + a `wdio://` custom protocol (the same bridge also wires the embedded server) | Dioxus → `wdio-dioxus-bridge` |

CDP frameworks need **no** in-app plumbing — Chromium exposes the protocol natively; a test-side CDP bridge package handles the connection.

→ **Worked detail:** [plumbing-cdp.md](plumbing-cdp.md) (CDP path — Electron) · [plumbing-wry.md](plumbing-wry.md) (Wry path — Tauri/Dioxus).

## Architecture layering

```
@wdio/native-types       — type-only; framework types + module augmentation
@wdio/native-utils       — generic primitives (logger, Result, config readers)
@wdio/native-spy         — mock framework + per-framework interceptor adapters
@wdio/native-core        — shared launcher infra (PortManager, DriverPool, DriverProcess,
                            BaseLauncher, logWriter, deeplink helpers, logLevel)
@wdio/<framework>-service — your new package
packages/<framework>-*    — Rust crates (Wry path only)
```

New services build **on `@wdio/native-core`** (Tauri and Dioxus do; Electron predates the extraction and is being migrated). Reuse port management, driver lifecycle, and log writing; add framework behaviour on top. Audit before extracting more into core — extract only what's duplicated bit-for-bit (see gotcha 2).

## Feature scope

**Converge on one surface.** Every service should expose as close to an identical API and feature set as possible — a user moving between `@wdio/electron-service`, `@wdio/tauri-service`, and a new service should barely relearn anything. Mocking is the template: one Vitest-like shape, standardised across all three. Design new features the same way (same method names, option names, semantics). The default answer to "should this service have feature X?" is **yes, with the same surface as the others**; you only omit a standard feature when the framework lacks the underlying concept, and then you document it as a known gap.

- **Standard surface — ship in every service, identical shape:** `execute`, mocking (`mock` + `clear/reset/restoreAllMocks` + `isMockFunction`, via `@wdio/native-spy`), `triggerDeeplink`, multi-window `switchWindow`/`listWindows`, backend+frontend log capture, browser mode, standalone/session mode, **multiremote + per-worker parallelism**, **headless on all supported platforms** (provided by WDIO's `@wdio/xvfb` / `autoXvfb` — being renamed `@wdio/display-server` in v10 — not by the service; CDP services use `autoXvfb` directly, Wry services wrap the command in `xvfb-run` because their driver runs in the launcher process), consistent config-option names.
- **Conditional only on the framework having the concept** (ship with the standard shape if it does): `emitEvent` (needs an event bus).
- **Framework-specific — additive, never a divergent reinvention:** Electron `mockAll`/class-mock + fuses/AppArmor/Chromedriver-versioning, Tauri CrabNebula provider, Dioxus bridge IPC. The *mechanism* of auto binary-path detection is framework-specific (skip when there's no canonical build tool), but the user-facing `appBinaryPath`/`application` option stays standard.
- **Not service features** (docs only, don't build): visual regression and video recording — usage examples composing with third-party WDIO packages we don't control (`@wdio/visual-service`, `wdio-video-reporter`).

→ **Full inventory, the known divergences to converge (Electron's window model, Dioxus's missing `emitEvent`), and the pattern behind each:** [features.md](features.md).

## Process

### Phase 0 — Pre-implementation spike

Validate platform constraints before any production code. Spikes are throwaway — they live in `/spike/<service>-spike/` (gitignored); the output is the **findings doc**, not the source.

1. Create a minimal app exercising the framework's public API.
2. **Confirm the Step 0 archetype** (does it expose CDP? which driver model? plugin or bridge?).
3. Identify the single most consequential unknown and write code that exercises it. Examples: "can a third-party crate flip Wry's `set_allows_automation`?" (Dioxus); "what's the CDP debugger-port discovery convention for this runtime?" (a CDP framework); "does the framework expose multiple addressable webview targets?".
4. Write `spike/FINDINGS.md`: the question, the answer with citations, the decision tree, and any **platform-by-platform variance** (often the most important section — e.g. the Dioxus Wry API is a no-op on Win/Mac but blocking on Linux).
5. Fold findings into the implementation plan: Risks, Platform Matrix, Phasing.

### Phase 1 — TypeScript service skeleton (shared, all archetypes)

Create `packages/<framework>-service/`:

```
src/
├── index.ts        public exports: default = worker service, named `launcher` = launch service
├── launcher.ts     extends BaseLauncher (main process)
├── service.ts      installs browser.<framework>.* surface (worker process)
├── session.ts      standalone-mode helpers (createXCapabilities, startWdioSession, cleanup)
├── errors.ts       SevereServiceError helpers
└── types.ts        re-exports public types from @wdio/native-types
```

**Conventions:**

- Initial npm version `1.0.0-next.0`. Build script: `tsx ../../scripts/build-package.ts`.
- Mirror the closest sibling's `package.json` exactly (exports, scripts, devDeps, peerDeps): CDP → clone `@wdio/electron-service`; Wry → clone `@wdio/tauri-service`. Always depend on `@wdio/native-core`, `@wdio/native-spy`, `@wdio/native-types`, `@wdio/native-utils` as workspace deps.
- `vitest.integration.config.ts` MUST set `fileParallelism: false` + 30s timeout + `setupFiles: ['test/integration/setup.ts']`.
- `tsconfig.json` extends `../../tsconfig.base.json`, out `./dist`, root `./src`.
- `index.ts`: `export { default as launcher } from './launcher.js'`, `export { default } from './service.js'`, plus session helpers and public types. Import `'@wdio/native-types'` for side-effect module augmentation.

**`launcher.ts`** extends `BaseLauncher`; implement `onPrepare` / `onComplete`. Throw a platform-specific `SevereServiceError` when a platform/provider combination is known-unsupportable (per spike). Handle browser mode (skip binary/driver setup) and multiremote shapes if in scope.

**Types in `@wdio/native-types/src/<framework>.ts`** (mirror `tauri.ts`):
`<Framework>APIs`, `<Framework>ExecuteOptions`, `<Framework>Mock<T,R>` + `<Framework>MockInstance`, `<Framework>ServiceAPI`, `<Framework>ServiceOptions` + `<Framework>ServiceGlobalOptions`, `<Framework>Capabilities`, `<Framework>BrowserExtension`. WebDriver path also: `<Framework>DriverProvider` (`'external' | 'embedded'` — never `'official'`, a deprecated Tauri alias). Then wire `@wdio/native-types/src/index.ts`: re-export the types, extend `BrowserExtension`, and `declare global { namespace WebdriverIO }` for `Browser`, `Capabilities['wdio:<framework>ServiceOptions']`, and `ServiceOption`.

> `<Framework>Capabilities` must be a **plain interface** — do NOT extend `Capabilities.RequestedStandaloneCapabilities` (Rollup's TS plugin can't extend dynamic-member interfaces). Intersect with it at service-level aliases instead (see `TauriServiceRequestedStandaloneCapabilities`).

### Phase 2 — Native plumbing (archetype-specific)

- **CDP path** → [plumbing-cdp.md](plumbing-cdp.md): CDP bridge connection, binary/build detection, no Rust.
- **Wry path** → [plumbing-wry.md](plumbing-wry.md): driver crate (external), bridge/plugin crate + guest-js, embedded WebDriver server crate, Cargo conventions, macOS throttling.

### Phase 3 — Tests (shared)

- `it('should ...')` throughout — never `it('does X')` / `it('returns Y')`. Tauri's suite is the reference.
- Files: `test/<module>.spec.ts` (unit), `test/integration/<module>.integration.spec.ts` (integration).
- Mock at the **`@wdio/native-core` boundary**, not local module boundaries, when a service module is a thin wrapper around core — otherwise the mock never reaches the real spawn/IO. Map-backed in-memory fake; see `packages/tauri-service/test/driverPool.spec.ts`.
- Rust: inline `#[cfg(test)] mod tests` with `should_*` names.
- Minimum at Phase 1 commit: `test/index.spec.ts` (export shape), `test/errors.spec.ts`, `test/launcher.spec.ts` (platform × provider matrix incl. every `SevereServiceError` throw).
- Coverage ≥80% (per `AGENTS.md`); thin-wrapper packages may declare an exception in `vitest.config.ts` with a comment explaining why.

### Phase 4 — CI gates

See [ci-and-release.md](ci-and-release.md) → "CI gates". Add `run_<framework>` outputs, path filters (`<framework>_service`, `e2e_<framework>`, `fixtures_<framework>`, `infra_<framework>`), extend the `shared` filter for any new `native-*` package, and clone the per-framework reusable workflows.

### Phase 5 — Fixtures, E2E, docs, release

- `fixtures/e2e-apps/<framework>/` — minimal app: execute + mock + multi-window.
- `e2e/test/<framework>/{api,application,execute-advanced,execute-data-types,logging,mocking,window}.spec.ts` mirroring `e2e/test/tauri/`. Also add `logging.external.spec.ts` if the service has an **external** driver provider — capturing the driver subprocess's stdout/stderr is a distinct code path from in-app frontend/backend logging and needs its own coverage.
- `e2e/wdio.<framework>.conf.ts` (+ `wdio.<framework>-embedded.conf.ts` for a Wry embedded provider).
- `packages/<framework>-service/README.md` + `docs/` set + per-crate READMEs.
- Root `README.md`, `ROADMAP.md`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `docs/*.md` updates.
- Release pipeline — see [ci-and-release.md](ci-and-release.md) → "Release pipeline".

## Naming conventions

| What | Convention | Example | Path |
|---|---|---|---|
| npm service package | `@wdio/<framework>-service` | `@wdio/dioxus-service` | all |
| WDIO service options key | `wdio:<framework>ServiceOptions` | `wdio:dioxusServiceOptions` | all |
| Browser API surface | `browser.<framework>.*` | `browser.dioxus.execute(...)` | all |
| CDP bridge package | `@wdio/<framework>-cdp-bridge` | `@wdio/electron-cdp-bridge` | CDP |
| Capability key | `<framework>:options` | `dioxus:options` | Wry |
| Automation env var | `<FRAMEWORK>_WEBVIEW_AUTOMATION` | `DIOXUS_WEBVIEW_AUTOMATION` | Wry |
| Window namespace | `window.__WDIO_<FRAMEWORK>__` | `window.__WDIO_DIOXUS__` | Wry |
| npm bridge JS bundle | `@wdio/<framework>-bridge` (no `-js`) | `@wdio/dioxus-bridge` | Wry/bridge |
| Rust bridge crate | `wdio-<framework>-bridge` | `wdio-dioxus-bridge` | Wry/bridge |
| Rust driver crate (external) | `wdio-<framework>-driver` (NOT `<framework>-driver`) | `wdio-dioxus-driver` | Wry/external |
| Rust embedded server (bridge route) | `wdio-<framework>-embedded-driver` | `wdio-dioxus-embedded-driver` | Wry/embedded, no plugin system |
| Rust embedded server (plugin route) | `<framework>-plugin-wdio-webdriver`-style | `tauri-plugin-wdio-webdriver` | Wry/embedded, has plugin system |

**`wdio-` prefix on Rust crates** leaves the unprefixed name (e.g. `dioxus-driver`) free for the framework's own project. The embedded server takes the **plugin** form when the framework has a plugin system (Tauri ships `tauri-plugin-wdio-webdriver` alongside the execute/mock plugin `tauri-plugin-wdio`) and the standalone `wdio-<framework>-embedded-driver` crate form otherwise (Dioxus, wired in via the bridge). **Providers** are `'external'` / `'embedded'` — `'official'` is a deprecated Tauri-only alias.

## Plan / PR split

Default to a 4-PR stacked split:

| PR | Branch (off main) | Scope |
|---|---|---|
| **PR1: Foundation** | `feat/<service>-foundation` | `@wdio/native-core` extractions; deprecation aliases on existing services. |
| **PR2: MVP** | `feat/<service>-mvp` (off PR1) | TS skeleton, native-plumbing skeleton, basic execute + mock, minimum CI. |
| **PR3: Feature Complete** | `feat/<service>-feature-complete` (off PR2) | Multi-window, deeplink, second provider, browser mode, macOS, headless on all supported platforms. |
| **PR4: Ship** | `feat/<service>-ship` (off PR3) | Package-test fixture, full docs, complete CI, release pipeline. |

Every PR must be green on all affected service suites + any `cargo test`. No regressions, ever.

## Common gotchas

1. **Pick the archetype first.** Cloning the wrong reference is the most expensive mistake. A CDP-based framework cloned from `tauri-service` would build a driver fork and Rust crates it never needs; a Wry framework cloned from `electron-service` would have no way to drive the webview. Confirm CDP vs WebDriver in the spike.
2. **Don't extract speculatively.** The Dioxus plan called for hoisting `logForwarder`/`logParser` into core; the audit found them too framework-specific (Tauri text-line vs Electron CDP events). Only `shouldLog` was genuinely shared. Audit before extracting.
3. **Mock at the right boundary.** Thin wrappers over `@wdio/native-core` must be tested by mocking core (`vi.mock('@wdio/native-core', …)`), not the local module — see `tauri-service/test/driverPool.spec.ts`.
4. **`Capabilities.RequestedStandaloneCapabilities` can't be extended** (Rollup TS plugin). Declare a plain interface; intersect at service aliases.
5. **(Wry) npm↔crate version lockstep.** The bridge crate's `build.rs` asserts the crate `Cargo.toml` and `package.json` agree on core `X.Y.Z`. npm uses `-next.N`, crates.io uses `-rc.N` — bump both together. See [plumbing-wry.md](plumbing-wry.md).
6. **(Wry/embedded) macOS background throttling.** WKWebView suspends the WebContent process running the JS polling loop when unfocused/napping on CI. The bridge sets `<FRAMEWORK>_WEBVIEW_AUTOMATION` and the app disables `with_background_throttling`. See [plumbing-wry.md](plumbing-wry.md).
7. **(Wry) `shared` paths-filter gaps.** Every `packages/native-*` must be in the `shared` filter of `_ci-detect-changes.reusable.yml`. Easy to miss; was a latent CI gap before Dioxus.
8. **(Wry) gitignore Rust artefacts.** `packages/*/target/` and `packages/*/Cargo.lock` in root `.gitignore` — once caused a 42 MB accidental commit.
9. **(Wry) Rust env-var tests** use `unsafe { std::env::set_var(...) }` (2024 edition). Keep them in one `mod tests` or clean up to avoid parallel interference.
10. **Async `LogWriter.close()`.** `@wdio/native-core`'s `LogWriter.close()` is async — it calls `stream.end(callback)` and waits for the flush. Launchers must `await closeLogWriter(...)` in `onComplete`, and tests exercising that path must mock `end: vi.fn((cb?) => cb?.())` so the promise resolves. Porting a synchronous Tauri-style `close()` caller without awaiting silently hangs the test.

## Verification checklist (per PR)

- [ ] `pnpm --filter @wdio/<framework>-service typecheck` clean
- [ ] `pnpm --filter @wdio/<framework>-service test:unit` green (all `it('should …')`)
- [ ] `pnpm --filter @wdio/<framework>-service test:coverage` ≥ 80%
- [ ] No regressions: `@wdio/tauri-service`, `@wdio/electron-service`, `@wdio/dioxus-service`, `@wdio/native-core` unit suites
- [ ] (Wry) `cargo check` + `cargo test` green for each new crate; no `packages/*/target/` staged

## Reference implementations (worked examples by archetype)

- **CDP** — `packages/electron-service/` + `packages/electron-cdp-bridge/`. The reference for any new CDP-based service.
- **Wry / plugin system** — `packages/tauri-service/` + `packages/tauri-plugin/` (execute/mock) + `packages/tauri-plugin-webdriver/` (`tauri-plugin-wdio-webdriver`, embedded server). Mature; all providers (external, embedded, CrabNebula), multiremote, browser mode. The reference for the **plugin-route embedded provider**.
- **Wry / no plugin system (bridge)** — `packages/dioxus-service/` + `dioxus-bridge` / `dioxus-embedded-driver` / `dioxus-driver`. The reference for the **bridge-route embedded provider** and for frameworks without a plugin system.
- **Plan files** — `~/.claude/plans/<plan>.md`. Start every service with a plan capturing Strategy, Package layout, Phasing, Risks, Open decisions.
- **Spike findings** — `spike/FINDINGS.md`.
