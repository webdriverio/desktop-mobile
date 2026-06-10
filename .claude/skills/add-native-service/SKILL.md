---
name: Add Native Service
description: Runbook for adding a new native-app testing service to this WebdriverIO monorepo. Covers every shipped architecture — desktop (Electron's CDP attach, Tauri's external WebDriver driver, Dioxus's in-process embedded driver + bridge crate) and mobile (React Native's Appium-driven native UI + Hermes/Metro JS-realm channel) — abstracted to apply to any new desktop or mobile framework. Use this skill when asked to add support for a new framework (desktop or mobile, e.g. Flutter/Capacitor), to bootstrap a new @wdio/<framework>-service package, to extend the supported-frameworks list in ROADMAP.md, or when shipping/refactoring any existing service along the shared pattern.
---

# Add Native Service

A runbook for bootstrapping a new WebdriverIO service package in this monorepo. It abstracts over the **architectures already shipped here** so the same process can ship any of them:

**Desktop:**
- **Electron** (`@wdio/electron-service`) — CDP attach, no driver process, no Rust.
- **Tauri** (`@wdio/tauri-service`) — Wry webview, external WebDriver driver + Tauri plugin crate.
- **Dioxus** (`@wdio/dioxus-service`) — Wry webview, in-process embedded WebDriver server + bridge crate.

**Mobile:**
- **React Native** (`@wdio/react-native-service`) — Appium-driven native UI (UiAutomator2/XCUITest); `execute`/`mock` over a Hermes/Metro JS-realm CDP channel. No driver process, no Rust.

If you follow this skill against any of those frameworks you should land in the same place the shipped package already is, and the same process bootstraps the next framework. See `ROADMAP.md` for what's planned (Flutter and Capacitor are the next mobile frameworks).

The single most important step is **Step 0**: identify which integration archetype your framework falls into — first **desktop or mobile**, then the axis within. It decides whether Phase 2 builds Rust crates, attaches over CDP, forks a driver, or composes with Appium — and which existing service you clone.

**Scope:** this skill covers **desktop** (CDP, Wry/WebDriver) and **mobile** (Appium) frameworks. Mobile is a third transport family with patterns desktop has no analogue for — device-pool allocation, Appium capability mutation, contexts-as-windows, a per-platform E2E split — all captured in [plumbing-mobile.md](plumbing-mobile.md) and flagged inline below.

## When to use

- A new desktop or mobile framework (e.g. Flutter, Capacitor) is being added per `ROADMAP.md`.
- An existing pre-1.0 service is being promoted from a Phase 0 spike to its first MVP package.
- You're validating that a framework can be automated before committing to a service implementation.
- You're refactoring one of the shipped services and want to keep it aligned with the shared pattern.

## When NOT to use

- Adding a feature to an already-shipped service — those have package-local conventions in each `README.md` / `docs/`.
- Pure refactors of `@wdio/native-core` — see the relevant `agent-os/specs/<spec>/` plan.

## Step 0 — Identify the integration archetype

Every framework resolves to a point in **one of two families**. First decide the family, then the axes within it. Confirm in the Phase 0 spike before writing code.

| Family | Signal | Driven by | Branch |
|---|---|---|---|
| **Desktop** | A windowed app you launch on the test host (Electron/Tauri/Dioxus) | The service spawns/attaches: a CDP client or a W3C WebDriver driver | Desktop axes below |
| **Mobile** | An app installed on a device/emulator/simulator (React Native, Flutter, Capacitor) | **Appium** owns the session + app launch (UiAutomator2/XCUITest); the service mutates caps + allocates devices | [Mobile](#mobile) below |

### Desktop

Resolves to a point on two axes (plus a plumbing sub-axis).

**Axis 1 — Transport: how does the test process drive the app?**

| | Signal | Path | Clone |
|---|---|---|---|
| **CDP attach** | Runtime exposes a Chrome DevTools Protocol endpoint (Chromium-based runtimes, e.g. Electron) | Attach a WebSocket CDP client. No driver process, no in-app Rust. | `@wdio/electron-service` + the shared `@wdio/native-cdp-bridge` |
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

CDP frameworks need **no** in-app plumbing — Chromium exposes the protocol natively; the shared `@wdio/native-cdp-bridge` package handles the connection.

### Mobile

A **third transport family**, not a point on the Desktop axes — there is no driver to spawn (Appium does), no in-app Rust, no `<framework>:options` capability, no `<FRAMEWORK>_WEBVIEW_AUTOMATION` env var. The launcher's job shifts to **capability mutation** (`appium:automationName` per platform, `appBinaryPath`→`appium:app`, `appium:udid`/`appium:avd`) and **device-pool allocation** (one device per worker, round-robin). The runner composes `services: ['appium', '<framework>']` (`@wdio/appium-service` is an **e2e/runner devDependency**, never a service-package dep — see gotcha 11). The service still extends `BaseLauncher`; a **Tier-1** service additionally reuses the shared `@wdio/native-cdp-bridge` for the JS-realm channel below (a Tier-2 service uses a non-CDP channel — e.g. Flutter's Dart VM Service — so it doesn't).

Appium always owns the **session**, but **two** things vary by framework. For a *native-widget* framework both collapse to the native path; a *self-rendered* framework diverges on both. (Worked detail + the instrumented-build requirement → [plumbing-mobile.md](plumbing-mobile.md).)

**Sub-axis 1 — find/tap: where do the elements live?**

| | Element model | Find/tap | Reference |
|---|---|---|---|
| **Native-widget** | renders real native views (`testID` → `accessibilityId`/`resource-id`) | standard Appium/W3C locators (`browser.$`) — the service adds nothing | React Native; Capacitor's native shell |
| **Self-rendered** | paints its own canvas; widgets are **invisible** to UiAutomator2/XCUITest | the framework's **own finder protocol** in a dedicated context (Flutter: `ByValueKey`/`ByText` via `ext.flutter.driver` in the `FLUTTER` context); normalise `getText` (iOS `value` vs Android `text`) | Flutter |

**Sub-axis 2 — the JS-realm channel: how do `execute`/`mock` reach the scripting realm?** (distinct from find/tap)

| | Signal | Channel | Mock tier | Reference |
|---|---|---|---|---|
| **Hermes / CDP** | RN's Hermes engine behind Metro's inspector-proxy | `@wdio/native-cdp-bridge` `CdpBridge` + a Hermes target selector + a Fusebox `Origin` header; Android needs `adb reverse tcp:8081`. **Sync IIFE only** — Hermes can't eval `async`. | **Tier 1** (transparent JS-eval injection) | `@wdio/react-native-service` |
| **Dart VM** | Flutter's own VM Service protocol (not CDP) | VM Service **`evaluate`** RPC drives `execute`; Dart has no monkeypatch, so only `mock` needs a cooperative contract | **Tier 2** (`mock` only — `execute` has an eval path) | Flutter (next) |
| **WebView context** | Pure-WebView app (Ionic/Capacitor) | Appium `WEBVIEW_*` context — `execute` runs in the webview over **W3C** (chromedriver/safaridriver), **not** the CDP bridge | Tier 1 (eval channel = the webview) | Capacitor (planned) |

For a **self-rendered** framework, find/tap (sub-axis 1) and `execute`/`mock` (sub-axis 2) often ride the **same** channel — Flutter does both over the VM Service.

**Decision rule for the mock tier:** is there an eval channel into the layer you want to mock? Yes → **Tier 1** (reuse the `native-spy` outer + an inner script-builder recorder, one-way `update()` sync — the desktop doctrine; the *transport* under the recorder still varies: RN's CDP bridge vs a webview's W3C `execute`). No → **Tier 2** (cooperative contract baked into the app/fixture; proven for Flutter in spike).

→ **Worked detail:** [plumbing-cdp.md](plumbing-cdp.md) (CDP — Electron) · [plumbing-wry.md](plumbing-wry.md) (Wry — Tauri/Dioxus) · [plumbing-mobile.md](plumbing-mobile.md) (Appium — React Native/Flutter/Capacitor).

## Architecture layering

```
@wdio/native-types       — type-only; framework types + module augmentation
@wdio/native-utils       — generic primitives (logger, Result, config readers)
@wdio/native-spy         — mock framework + per-framework interceptor adapters
@wdio/native-cdp-bridge  — shared CDP transport (single + multi-target): Electrobun, React Native
                            (Hermes); Electron next. Electron's own @wdio/electron-cdp-bridge is
                            the legacy per-framework instance.
@wdio/native-core        — shared launcher infra (PortManager, DriverPool, DriverProcess,
                            BaseLauncher, logWriter, OS-protocol deeplink helpers, logLevel)
@wdio/native-mobile-core — shared Appium layer: caps, device pool, contexts, mobile deeplink,
                            log channels. (extract when Flutter lands — see plumbing-mobile.md)
@wdio/<framework>-service — your new package
packages/<framework>-*    — Rust crates (Wry path only)
```

New services build **on `@wdio/native-core`** (Tauri and Dioxus do; Electron predates the extraction and is being migrated). Reuse port management, driver lifecycle, and log writing; add framework behaviour on top. Audit before extracting more into core — extract only what's duplicated bit-for-bit (see gotcha 2).

**Mobile** services reuse `BaseLauncher` (the hook lifecycle) but **none** of the `native-core` driver/port/OS-protocol-deeplink primitives — Appium owns the session; **Tier-1** services additionally use `@wdio/native-cdp-bridge` for the JS-realm channel (Tier-2 doesn't). The shared mobile concerns (caps, device pool, contexts, `mobile: deepLink`, device-log channels) live in the RN package today and graduate to a new `@wdio/native-mobile-core` **when Flutter — the second consumer — lands** (extract-on-second-use, gotcha 2). See [plumbing-mobile.md](plumbing-mobile.md) → "Shared-layer extraction".

## Feature scope

**Converge on one surface.** Every service should expose as close to an identical API and feature set as possible — a user moving between `@wdio/electron-service`, `@wdio/tauri-service`, `@wdio/react-native-service`, and a new service should barely relearn anything. Mocking is the template: one Vitest-like shape, standardised across every service. Design new features the same way (same method names, option names, semantics). The default answer to "should this service have feature X?" is **yes, with the same surface as the others**; you only omit a standard feature when the framework lacks the underlying concept, and then you document it as a known gap.

- **Standard surface — ship in every service, identical shape:** `execute`, mocking (`mock` + `clear/reset/restoreAllMocks` + `isMockFunction`, via `@wdio/native-spy`), `triggerDeeplink`, multi-window `switchWindow`/`listWindows`, backend+frontend log capture, browser mode, standalone/session mode, **multiremote + per-worker parallelism**, **headless on all supported platforms** (provided by WDIO's `@wdio/xvfb` / `autoXvfb` — being renamed `@wdio/display-server` in v10 — not by the service; CDP services use `autoXvfb` directly, Wry services wrap the command in `xvfb-run` because their driver runs in the launcher process), consistent config-option names. **Mobile keeps the same surface with mobile semantics:** `switchWindow`/`listWindows` = Appium contexts (`NATIVE_APP` ↔ `WEBVIEW_*`); `triggerDeeplink` = `mobile: deepLink` (+ Android `am start` fallback); log capture = native `logcat`/`syslog` **plus** JS-console-over-CDP; multiremote/parallelism = a device pool instead of per-worker driver ports; headless = the emulator/simulator (no Xvfb).
- **Two mock tiers, one surface.** Mocking is always the same Vitest-like API, but the *inner* mechanism has two tiers: **Tier 1** transparent JS-eval injection (`native-spy` outer + an inner script-builder recorder — desktop CDP/Wry and RN/Hermes) and **Tier 2** a cooperative opt-in contract baked into the app/fixture (Flutter/Dart-VM, where the target can't be transparently rewritten — `execute` still works via the VM `evaluate` RPC; only `mock` needs the contract). Decision rule: *can you transparently rewrite the target through an eval channel?* See [features.md](features.md) → "Mocking — the two-tier doctrine".
- **Conditional only on the framework having the concept** (ship with the standard shape if it does): `emitEvent` (needs an event bus).
- **Framework-specific — additive, never a divergent reinvention:** Electron `mockAll`/class-mock + fuses/AppArmor/Chromedriver-versioning, Tauri CrabNebula provider, Dioxus bridge IPC. The *mechanism* of auto binary-path detection is framework-specific (skip when there's no canonical build tool), but the user-facing `appBinaryPath`/`application` option stays standard.
- **Not service features** (docs only, don't build): visual regression and video recording — usage examples composing with third-party WDIO packages we don't control (`@wdio/visual-service`, `wdio-video-reporter`).

→ **Full inventory, the known divergences to converge (Electron's window model, Dioxus's missing `emitEvent`), and the pattern behind each:** [features.md](features.md).

## When upstream blocks the standard surface (shipping pre-1.0)

Some frameworks — especially a **beta/pre-1.0 upstream** — can't yet support the full convergent
surface above: a platform may have no working automation path, or a standard feature (multiremote,
multi-window, deeplink) may be blocked by a framework/runtime limitation you **cannot fix from the
service layer**. Don't force-fit, and don't hold the whole package hostage to upstream — ship the
working subset, clearly scoped, and recover the rest as upstream lands fixes.

**Version: base at `0.1.0`, not `1.0.0`.** The default convention here is a `X.Y.0-next.0` dev
placeholder in `package.json` that releases as stable `X.Y.0` on `latest` (with `-next.N` prereleases
on the `next` dist-tag in between — every service does this: electron `10.0.0-next.N`→`10.0.0`, tauri
`1.0.0-next.N`→`1.0.0`). A full-convergent-surface service bases that at `1.0` (placeholder
`1.0.0-next.0`, release `1.0.0`). When upstream blocks a lot, `1.0` over-promises — base it at **`0.x`**,
the semver signal for "early, partial, scope may change, gaps expected". Keep the same release
*machinery*, just lower the base:
- **Dev placeholder `0.1.0-next.0`** (a prerelease *of* 0.1.0 — NOT `1.0.0-next.0`, which implies a 1.0 target).
- **First stable release `0.1.0`** on `latest`; `0.1.0-next.N` prereleases on `next` during lead-up. (`0.x` = unstable API; `-next.N` = staging channel — orthogonal, you want both.)
- **Minor bumps** (`0.2.0`, `0.3.0`…) as each upstream fix recovers a platform/feature. Breaking changes are allowed within `0.x` (bump minor).
- **Graduate to `1.0.0`** only at full parity with the sibling services — the whole standard surface on all intended platforms. `1.0` is the promise that the convergent surface works.

**Be honest in CI — skip, don't allow-failure.** For a platform/suite that's **blocked upstream**
(not merely flaky), **remove its jobs entirely** rather than marking them allow-failure. Allow-failure
legs that can *never* pass only burn CI minutes (slow runtime downloads, etc.) and add permanent red
noise that trains everyone to ignore the column. Keep the validated platform/suite as the **required
gate**; leave a comment on the removed jobs naming the upstream blocker and the condition to re-add
them. (Reserve allow-failure for legs that are *unverified-but-plausible*, not *known-blocked*.)

**Fail fast at runtime.** Add an explicit `SevereServiceError` in `launcher.onPrepare` for an
unsupported platform/mode, with an actionable message ("`<service>` is macOS-only in v1 — `<platform>`
is blocked by `<upstream issue>`"). A clear early throw beats letting users hit a cryptic
attach/connection timeout. Gate it on a platform parameter (not bare `process.platform`) so the
launcher tests can exercise both branches.

**Keep the blocked specs, don't delete them.** Leave the blocked-feature e2e specs in the tree with a
NOT-RUN-IN-CI header comment, runnable locally via `TEST_TYPE=…`, and excluded from the CI matrix.
They are the re-enable checklist for when upstream lands.

**Document + file upstream — aggregate in the plan first, then ONE issue.** As you discover gaps,
collect them into a dedicated **"Upstream fixes needed"** section of the implementation plan — each
with its impact on the surface, the feature/platform it unblocks, and **exact source refs**
(`file:line`). Gaps surface across many debugging sessions; without one home in the plan they get lost,
and that section becomes the turnkey brief for the post-ship filing step. Before filing anything,
**search the upstream repo's issues (open *and* closed)** for every gap: a young/beta upstream usually
already tracks several, and a **closed** issue often explains current behaviour — e.g. a "completed"
fix that was really a band-aid fallback is frequently *why* one platform works while others don't.
Then choose the filing shape by **whether aggregation actually helps triage** — the gap *count* is
only a heuristic, so don't reflexively build (or skip) an umbrella on a number alone:
- **One gap → never an umbrella.** Nothing to aggregate. If it's already tracked upstream, comment
  on / +1 the existing issue; if it's net-new, file one focused issue.
- **Two gaps → usually still no umbrella, but combine if related.** If the two share a root cause or
  the same consumer goal, file **one issue covering both** — a lightweight combined issue, *not* the
  full see-also structure. If they're unrelated, handle each on its own (comment on the existing
  issue, or file a focused one). The deciding question is "does framing them together help the
  maintainer?", not "are there two of them?".
- **Three or more related gaps → ONE umbrella issue**, framed around the consumer goal ("drive `<framework>`
  apps with external WebDriver/CDP automation"). For each gap that **already has an issue**, link it
  (`see also #N`) — don't duplicate. Each **net-new** gap (no existing issue) is captured *by the
  umbrella itself*, since the umbrella is a new issue: describe it inline as its own section with
  source refs. Only **split a net-new gap into its own dedicated issue** (then link it from the
  umbrella, `see also #N`) when it's large and cleanly separable enough that the maintainer would want
  to triage/close it independently — otherwise inline is enough. A single well-researched issue
  connecting the maintainer's own scattered issues to a concrete use case triages far better — and
  gives you **one canonical URL** to link everywhere — than several parallel issues that duplicate
  what's already filed. Drop a one-line cross-link comment on the most directly related existing issues.

Record every gap as a known limitation in the service README/docs +
`ROADMAP.md`, and link the umbrella issue into the docs + the CI re-add notes. As each underlying fix
lands: re-add the job, drop the runtime-guard branch, lift the docs limitation, and bump the minor
version.

> **Worked example — `@wdio/electrobun-service`.** Electrobun's CEF chrome-runtime can't create the
> `persist:default` partition profile its `BrowserWindow` forces; macOS recovers via a global-context
> fallback but Linux/Windows serve no `/json`, and multiremote/multi-window/deeplink all trace to the
> same gap — none fixable from the service. So v1 ships **macOS-only, single-window, `0.1.0`**: the
> Linux/Windows build+e2e jobs are removed (not allow-failure), the window/deeplink specs are
> skipped-but-kept, and a macOS-only runtime guard fails fast elsewhere. The plan's "Framework gaps"
> aggregates every gap with source refs; the **search-first** pass found the upstream already tracking
> most of them — `#380` (the proper profile-isolation fix), `#445` (remote-debugging opt-in, but only
> noting macOS — Linux's `remote_debugging_port` is *commented out*), `#448` (a user hitting the same
> Linux profile error), plus `#278`/`#122` **closed** (the global-context band-aid that explains macOS
> recovery, and a prior e2e request). So rather than file four duplicates, the post-ship step is **one
> umbrella issue** ("enable external WebDriver/CDP automation for CEF apps") that links those, adds the
> net-new findings (the Linux commented-out port; the macOS-recovers/others-don't `/json` asymmetry;
> single-instance lock + `open-url` routing for deeplink — which has *no* existing issue), and is the
> one URL linked from the docs.

## Process

### Phase 0 — Pre-implementation spike

Validate platform constraints before any production code. Spikes are throwaway — they live in `/spike/<service>-spike/` (gitignored); the output is the **findings doc**, not the source.

1. **Check out the target framework's source locally — a hard precursor, not optional.** Clone the upstream repo at a known-good *released* tag (don't `file:`-link it into the build; pin the published release — see Risks). You will read it constantly throughout the whole project: to confirm the Step 0 archetype, to find the runtime's debug-port / automation conventions, and — every time you later hit an upstream gap — to trace it to an exact `file:line` you can cite. A service built without the framework source open beside you is guesswork; note its path in the plan (e.g. `~/Workspace/<framework>`) so later sessions reuse it.
2. Create a minimal app exercising the framework's public API.
3. **Confirm the Step 0 archetype** (does it expose CDP? which driver model? plugin or bridge?) — by reading the source from step 1, not by assuming.
4. Identify the single most consequential unknown and write code that exercises it. Examples: "can a third-party crate flip Wry's `set_allows_automation`?" (Dioxus); "what's the CDP debugger-port discovery convention for this runtime?" (a CDP framework); "does the framework expose multiple addressable webview targets?".
5. Write `spike/FINDINGS.md`: the question, the answer with citations (`file:line` into the local checkout), the decision tree, and any **platform-by-platform variance** (often the most important section — e.g. the Dioxus Wry API is a no-op on Win/Mac but blocking on Linux).
6. Fold findings into the implementation plan: Risks, Platform Matrix, Phasing.

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

- Initial `package.json` dev placeholder `1.0.0-next.0` for a service that reaches the full convergent surface on its target platforms (releases as stable `1.0.0`) — or **`0.1.0-next.0`** (releases as `0.1.0`) if upstream blocks a lot of the surface (see [When upstream blocks the standard surface](#when-upstream-blocks-the-standard-surface-shipping-pre-10)). Build script: `tsx ../../scripts/build-package.ts`.
- Mirror the closest sibling's `package.json` exactly (exports, scripts, devDeps, peerDeps): CDP → clone `@wdio/electron-service`; Wry → clone `@wdio/tauri-service`; **Mobile → clone `@wdio/react-native-service`**. Always depend on `@wdio/native-core`, `@wdio/native-spy`, `@wdio/native-types`, `@wdio/native-utils` as workspace deps. **Only Tier-1 mobile** (an eval-channel framework — e.g. RN/Hermes) adds `@wdio/native-cdp-bridge`; a **Tier-2** framework (Dart-VM/Flutter) never constructs a `CdpBridge` (its eval channel is the Dart VM Service, not CDP), and must **drop that dep** when cloning RN. **Mobile: do NOT add `@wdio/appium-service` as a package dep** — it's composed at the runner (`services: ['appium', '<framework>']`) and stays an e2e devDependency.
- `vitest.integration.config.ts` MUST set `fileParallelism: false` + 30s timeout + `setupFiles: ['test/integration/setup.ts']`.
- `tsconfig.json` extends `../../tsconfig.base.json`, out `./dist`, root `./src`.
- `index.ts`: `export { default as launcher } from './launcher.js'`, `export { default } from './service.js'`, plus session helpers and public types. Import `'@wdio/native-types'` for side-effect module augmentation.

**`launcher.ts`** extends `BaseLauncher`; implement `onPrepare` / `onComplete`. Throw a platform-specific `SevereServiceError` when a platform/provider combination is known-unsupportable (per spike). Handle browser mode (skip binary/driver setup) and multiremote shapes if in scope.

**Mobile branch — the skeleton differs.** Clone `@wdio/react-native-service`, not a desktop service:
- The `src/` tree drops the desktop driver pieces and adds mobile ones: `capabilities.ts` (Appium cap shaping), `deviceManager.ts` (device pool), `serviceConfig.ts` (option merge), `commands/{execute,switchContext,triggerDeeplink,emitEvent}.ts`, `logCapture.ts`, plus the JS-realm channel for your sub-axis (RN: `metroBridge.ts`/`hermesBridge.ts`/`hermesTarget.ts` + `mock.ts`/`innerRecorder.ts`/`mockStore.ts`). **That list is RN's *pre-extraction* layout** (RN is the first consumer).
- **If `@wdio/native-mobile-core` is already extracted** — it should be, before a *second* mobile service ([plumbing-mobile.md](plumbing-mobile.md) → "Shared-layer extraction") — **consume** the shared Appium infra (`capabilities`/`deviceManager`/`switchContext`/`triggerDeeplink`/device-log capture) from it rather than rebuilding those files. Your package then builds only the framework-specific JS-realm channel, the find/tap glue (below), and the thin launcher/service wiring.
- **Find/tap (Step 0 sub-axis 1).** A **native-widget** framework (RN) adds nothing — `testID`s surface as `accessibilityId`/`resource-id` and `browser.$` just works. A **self-rendered** framework (Flutter) must wire its **own finder protocol** (the `FLUTTER` context + `ByValueKey`/`ByText`) and normalise `getText` (iOS `value` vs Android `text`); this glue is framework-specific — it stays in the service package, never `native-mobile-core`.
- `launcher.ts` still extends `BaseLauncher` but implements **`onPrepare` (cap mutation) + `onWorkerStart`/`onWorkerEnd` (device claim/release)** — no `onComplete` driver teardown (Appium owns the session).
- The service `*ServiceOptions` extend **`LogCaptureConfig, MockLifecycleConfig`**, **not `BaseServiceOptions`** — Appium launches via caps, so the desktop binary-launch fields (`appArgs`, startup/command timeouts) don't apply. `<Framework>Capabilities` is a plain Appium-cap interface (`platformName`, `appium:*`, `wdio:<framework>ServiceOptions`).
- Worker hooks: `before` (attach JS-realm bridge + install `browser.<framework>.*`), `beforeTest` (mock lifecycle), **`afterTest` (drain native device logs)**, `after`/`afterSession` (close bridge). See [plumbing-mobile.md](plumbing-mobile.md).

**Types in `@wdio/native-types/src/<framework>.ts`** (mirror `tauri.ts`, or `react-native.ts` for mobile):
`<Framework>APIs`, `<Framework>ExecuteOptions`, `<Framework>Mock<T,R>` + `<Framework>MockInstance`, `<Framework>ServiceAPI`, `<Framework>ServiceOptions` + `<Framework>ServiceGlobalOptions`, `<Framework>Capabilities`, `<Framework>BrowserExtension`. WebDriver path also: `<Framework>DriverProvider` (`'external' | 'embedded'` — never `'official'`, a deprecated Tauri alias). Then wire `@wdio/native-types/src/index.ts`: re-export the types, extend `BrowserExtension`, and `declare global { namespace WebdriverIO }` for `Browser`, `Capabilities['wdio:<framework>ServiceOptions']`, and `ServiceOption`.

> `<Framework>Capabilities` must be a **plain interface** — do NOT extend `Capabilities.RequestedStandaloneCapabilities` (Rollup's TS plugin can't extend dynamic-member interfaces). Intersect with it at service-level aliases instead (see `TauriServiceRequestedStandaloneCapabilities`).

### Phase 2 — Native plumbing (archetype-specific)

- **CDP path** → [plumbing-cdp.md](plumbing-cdp.md): CDP bridge connection, binary/build detection, no Rust.
- **Wry path** → [plumbing-wry.md](plumbing-wry.md): driver crate (external), bridge/plugin crate + guest-js, embedded WebDriver server crate, Cargo conventions, macOS throttling.
- **Mobile path** → [plumbing-mobile.md](plumbing-mobile.md): Appium composition + capability mutation, device pool, the JS-realm sub-axis (Hermes-CDP / Dart-VM / WebView), contexts, deeplink, logs, shared-layer extraction. No Rust, no driver.

### Phase 3 — Tests (shared)

- `it('should ...')` throughout — never `it('does X')` / `it('returns Y')`. Tauri's suite is the reference.
- Files: `test/<module>.spec.ts` (unit), `test/integration/<module>.integration.spec.ts` (integration).
- Mock at the **`@wdio/native-core` boundary**, not local module boundaries, when a service module is a thin wrapper around core — otherwise the mock never reaches the real spawn/IO. Map-backed in-memory fake; see `packages/tauri-service/test/driverPool.spec.ts`.
- Rust: inline `#[cfg(test)] mod tests` with `should_*` names.
- Minimum at Phase 1 commit: `test/index.spec.ts` (export shape), `test/errors.spec.ts`, `test/launcher.spec.ts` (platform × provider matrix incl. every `SevereServiceError` throw).
- **Mobile** (`@wdio/react-native-service/test/` is the reference): the launcher matrix is **platform × automationName** (Android→UiAutomator2, iOS→XCUITest, unsupported→`SevereServiceError`); test the device pool's fairness/release (round-robin, more-workers-than-devices warning); and unit-test the Tier-1 mock script-builders as the **JS expressions they emit**, not in-realm behaviour (the realm semantics are only exercised E2E against a live Metro/Hermes target).
- Coverage ≥80% (per `AGENTS.md`); thin-wrapper packages may declare an exception in `vitest.config.ts` with a comment explaining why.

### Phase 4 — CI gates

See [ci-and-release.md](ci-and-release.md) → "CI gates". Add `run_<framework>` outputs, path filters (`<framework>_service`, `e2e_<framework>`, `fixtures_<framework>`, `infra_<framework>`), extend the `shared` filter for any new `native-*` package, and clone the per-framework reusable workflows. `scripts/detect-changes.ts` auto-discovers a `packages/<framework>-service` by convention, but its **test cases in `test/scripts/detect-changes.spec.ts` are per-framework** — add the new framework's paths (RN's are already in; this recurs for Flutter; CI's lint job runs `test:scripts`). **Mobile clones per-platform E2E workflows** (`_ci-e2e-<framework>.reusable.yml` Android + `_ci-e2e-<framework>-ios.reusable.yml`), not the desktop `-all-providers` shape.

### Phase 5 — Fixtures, E2E, docs, release

- `fixtures/e2e-apps/<framework>/` — minimal app exercising the service surface (execute + mock + multi-window). See **Fixture app conventions** below. **Mobile**: one fixture app drives every leg; the native `android/`/`ios/` projects are **generated in CI (not committed)** by scaffolding a pinned framework version and overlaying the fixture source. RN additionally runs it under a **dual-architecture matrix** (Paper + Fabric) — that's RN-specific (see ci-and-release.md), not a universal mobile rule.
- `fixtures/package-tests/<framework>-app/` — package-install smoke fixture. Same visual conventions; reduced functional surface (typically just `#app-title` + `#status`). **Mobile package-tests are ESM-only** (a CJS config can't compose `services: ['appium', …]` — `@wdio/appium-service` + WDIO v9 core are ESM-only); ship one ESM fixture, no CJS variant. May be a deferred follow-up (RN's isn't shipped yet — file a tracked issue).
- `e2e/test/<framework>/{api,application,execute-advanced,execute-data-types,logging,mocking,window}.spec.ts` mirroring `e2e/test/tauri/`. Also add `logging.external.spec.ts` if the service has an **external** driver provider — capturing the driver subprocess's stdout/stderr is a distinct code path from in-app frontend/backend logging and needs its own coverage. **Mobile** mirrors `e2e/test/react-native/` (`{api,application,execute,mocking,logging,contexts,deeplink}.spec.ts`).
- `e2e/wdio.<framework>.conf.ts` (+ `wdio.<framework>-embedded.conf.ts` for a Wry embedded provider). **Mobile**: `services: ['appium', '<framework>']`, `maxInstances: 1`, `specFileRetries: 1` (absorbs emulator/sim-boot + first-session flake), generous `connectionRetryTimeout`, an **app-ready `before` gate** (`waitForDisplayed` on a known element), and a **page-source-on-failure `afterTest`** (writes the Appium UI hierarchy to the uploaded logs). iOS reads `RN_WDA_DD`/device env to reuse a prebuilt WebDriverAgent.
- `packages/<framework>-service/README.md` + `docs/` set + per-crate READMEs.
- Root `README.md`, `ROADMAP.md`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `docs/*.md` updates.
- Release pipeline — see [ci-and-release.md](ci-and-release.md) → "Release pipeline".

### Follow-up tracking (cross-cutting)

Building a service surfaces deferred work that doesn't belong in the current PR: a bug **inherited
from the cloned-from template** (so the *source* service still has it), a migration the new package
enables, a feature pushed to a later release, an internal cleanup. Don't bury these in commit
messages — **file a GitHub issue** as soon as the item is concrete (search-first to dedup; label with
`type:bug`/`type:task` + the relevant `scope:*`) and reference it from the PR that surfaced it. This
is distinct from the upstream-gap umbrella issue above: that tracks what blocks the *current* service;
these track what the current work leaves for *later*. Cloning a sibling's `*.ts`/`package.json` is the
highest-yield source — a defect you fix in the new copy almost always still lives in the original, so
file the sibling fix immediately. Half-formed ideas that aren't yet actionable don't need an issue —
drop them until they are.

#### Fixture app conventions

The same convergence principle that applies to the API surface ([features.md](features.md)) applies to fixtures. Every fixture — both `fixtures/e2e-apps/<framework>/` and `fixtures/package-tests/<framework>-app/` — uses a **shared visual + functional template** so a screenshot of one is largely interchangeable with a screenshot of any other. New fixtures must adopt it.

**Visual template ("big-glass"):**

- Background: `linear-gradient(135deg, #667eea 0%, #764ba2 100%)` (purple). Splash screens use the same gradient.
- `.container`: `background: rgba(255, 255, 255, 0.15)`, `backdrop-filter: blur(15px)`, `border-radius: 25px`, `padding: 50px`, `max-width: 800px`, with a `border: 1px solid rgba(255, 255, 255, 0.25)` and `box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15)`.
- `h1`: `font-size: 3em`, `font-weight: 200`, text-shadow `0 2px 10px rgba(0, 0, 0, 0.3)`.
- `button`: white-translucent (`rgba(255, 255, 255, 0.25)`, `border: 2px solid rgba(255, 255, 255, 0.4)`), `border-radius: 12px`, hover lifts with `translateY(-3px)`.
- `#counter` (when present): `font-size: 4em`, `color: #61dafb` (carried over from the original Tauri theme — the only colour accent on top of the white-on-purple base).
- `.info-section` panel for status/log output: `background: rgba(0, 0, 0, 0.25)`, `border-radius: 15px`, SF Mono / Monaco font.
- White text throughout.

**Functional content:**

- When the framework can render a UI, ship an **increment / decrement / reset counter + status panel**. Stable selectors: `#app-title`, `#counter`, `#increment-button`, `#decrement-button`, `#reset-button`, `#status` (used by `visual.spec.ts` and `application.spec.ts`).
- CDP fixtures (Electron) additionally include the window-resize / show-dialog buttons that exercise Electron's extras — these are framework-additive and live alongside the standard counter UI, not in place of it.
- The package-test fixture is allowed to ship a reduced surface (typically just `#app-title` + `#status`) since the install-smoke spec doesn't need the counter — but the visual styling stays identical.

**Canonical references:**

- HTML fixtures: `fixtures/e2e-apps/electron-builder/src/renderer/index.html`.
- rsx / Rust fixtures: `fixtures/e2e-apps/dioxus/src/main.rs` (CSS lives in a `SHARED_STYLES: &str` const fed into the rsx `style { }` block).
- Tauri counter UI on the shared theme: `fixtures/e2e-apps/tauri/index.html`.

Don't introduce a new per-framework gradient or container style — pick `.container` + counter rule from the references above and only add framework-specific *content* on top.

## Naming conventions

| What | Convention | Example | Path |
|---|---|---|---|
| npm service package | `@wdio/<framework>-service` | `@wdio/react-native-service` | all |
| WDIO service options key | `wdio:<framework>ServiceOptions` | `wdio:reactNativeServiceOptions` | all |
| Browser API surface | `browser.<framework>.*` | `browser.reactNative.execute(...)` | all |
| Shared CDP bridge | `@wdio/native-cdp-bridge` (shared; electron's `@wdio/electron-cdp-bridge` is the legacy per-framework instance) | — | CDP + Mobile/Hermes |
| Capability key | `<framework>:options` | `dioxus:options` | Wry |
| Automation toggle env var | `<FRAMEWORK>_WEBVIEW_AUTOMATION` | `DIOXUS_WEBVIEW_AUTOMATION` | Wry |
| Embedded-driver port env var | `<FRAMEWORK>_WEBVIEW_AUTOMATION_PORT` | `DIOXUS_WEBVIEW_AUTOMATION_PORT` | Wry/embedded |
| Window namespace | `window.__WDIO_<FRAMEWORK>__` | `window.__WDIO_DIOXUS__` | Wry |
| Appium automation name | per platform: Android `UiAutomator2`, iOS `XCUITest` (on `appium:automationName`) | — | Mobile |
| Appium launch caps | `appium:app` / `appium:appPackage`+`appium:appActivity` (Android) / `appium:bundleId` (iOS) | — | Mobile |
| Device descriptor | `{ udid?, avd?, iOSUdid? }` (Android serial / AVD name / iOS sim UDID) | `{ avd: 'Pixel_7_API_35' }` | Mobile |
| Inner-mock realm namespace | `globalThis.__WDIO_<FRAMEWORK>_MOCKS__` | `globalThis.__WDIO_RN_MOCKS__` | Mobile/Tier-1 |
| E2E env vars (conf, not service) | `<FW>_PLATFORM` / `<FW>_APP_PATH` / `<FW>_METRO_PORT` / `<FW>_WDA_DD` / `<FW>_IOS_DEVICE` | `RN_PLATFORM`, `RN_WDA_DD` | Mobile E2E |
| Release scope label | `scope:<framework>` | `scope:react-native` | all |
| npm bridge JS bundle | `@wdio/<framework>-bridge` (no `-js`) | `@wdio/dioxus-bridge` | Wry/bridge |
| Rust bridge crate | `wdio-<framework>-bridge` | `wdio-dioxus-bridge` | Wry/bridge |
| Rust driver crate (external) | `wdio-<framework>-driver` (NOT `<framework>-driver`) | `wdio-dioxus-driver` | Wry/external |
| Rust embedded server (bridge route) | `wdio-<framework>-embedded-driver` | `wdio-dioxus-embedded-driver` | Wry/embedded, no plugin system |
| Rust embedded server (plugin route) | `<framework>-plugin-wdio-webdriver`-style | `tauri-plugin-wdio-webdriver` | Wry/embedded, has plugin system |

For a **new** service, pair the embedded port var with the toggle prefix: `<FRAMEWORK>_WEBVIEW_AUTOMATION_PORT` (as Dioxus does). Tauri's `TAURI_WEBDRIVER_PORT` predates this convention — don't copy it.

**`wdio-` prefix on Rust crates** leaves the unprefixed name (e.g. `dioxus-driver`) free for the framework's own project. The embedded server takes the **plugin** form when the framework has a plugin system (Tauri ships `tauri-plugin-wdio-webdriver` alongside the execute/mock plugin `tauri-plugin-wdio`) and the standalone `wdio-<framework>-embedded-driver` crate form otherwise (Dioxus, wired in via the bridge). **Providers** are `'external'` / `'embedded'` — `'official'` is a deprecated Tauri-only alias.

**Mobile naming has no Wry analogues:** no automation-toggle env var, no `<framework>:options` capability, no `<FRAMEWORK>_WEBVIEW_AUTOMATION_PORT` — the launch surface is the `appium:*` namespace. For a **multi-word** framework, the options key + browser surface camel-case the name: `react-native` → `wdio:reactNativeServiceOptions` / `browser.reactNative` (the package and `scope:` label stay hyphenated: `@wdio/react-native-service`, `scope:react-native`).

## Plan / PR split

Default to a 4-PR stacked split:

| PR | Branch (off main) | Scope |
|---|---|---|
| **PR1: Foundation** | `feat/<service>-foundation` | `@wdio/native-core` extractions; deprecation aliases on existing services. |
| **PR2: MVP** | `feat/<service>-mvp` (off PR1) | TS skeleton, native-plumbing skeleton, basic execute + mock, minimum CI. |
| **PR3: Feature Complete** | `feat/<service>-feature-complete` (off PR2) | Multi-window, deeplink, second provider, browser mode, macOS, headless on all supported platforms. |
| **PR4: Ship** | `feat/<service>-ship` (off PR3) | Package-test fixture, full docs, complete CI, release pipeline. |

Every PR must be green on all affected service suites + any `cargo test`. No regressions, ever.

**Split E2E into its own PR when the fixture's build+run in CI is itself high-risk.** The 4-PR default folds the E2E specs + `wdio.<framework>.conf.ts` + CI gates into Ship. That's fine for a framework with a *mature, proven build toolchain*. But for an **immature/novel toolchain** — a pre-1.0/beta CLI, large per-OS runtime downloads, a new driver, or a platform whose automation path is unverified — getting the fixture to build and run headless in CI is usually the single biggest unknown, and it's iterative and flaky-prone. Bundling that into Ship holds docs + release hostage to it and risks publishing a service E2E never actually exercised. In that case use a **5-PR split**: insert a dedicated **PR4: E2E** (`feat/<service>-e2e`) — fixture CI build + `_ci-build-<framework>-e2e-app` / `-all-providers` reusable workflows + e2e specs + `wdio.<framework>.conf.ts` + headless — and make **PR5: Ship** (docs + release) depend on it, so you *prove it runs before you publish*. (Electrobun is the worked example: beta Bun/CEF toolchain with build defects + an unverified Linux CDP path.) Keep the e2e *fixture app* itself in PR3 either way; it's only the CI-build-and-run that warrants isolating.

The 5-PR split, mirroring the table above:

| PR | Branch (off main) | Scope |
|---|---|---|
| **PR1: Foundation** | `feat/<service>-foundation` | As in the 4-PR split. |
| **PR2: MVP** | `feat/<service>-mvp` (off PR1) | As in the 4-PR split. |
| **PR3: Feature Complete** | `feat/<service>-feature-complete` (off PR2) | As in the 4-PR split, **plus the e2e fixture app** (the app source — not its CI run). |
| **PR4: E2E** | `feat/<service>-e2e` (off PR3) | Fixture CI build + `_ci-build-<framework>-e2e-app` / `-all-providers` reusable workflows, e2e specs, `wdio.<framework>.conf.ts`, headless. The risky "prove it runs in CI" PR. |
| **PR5: Ship** | `feat/<service>-ship` (off PR4) | Package-test fixture, full docs, complete CI gates, release pipeline (everything from 4-PR Ship except the e2e specs, which moved to PR4). |

**Mobile: split the E2E PR *per platform*.** Mobile multiplies the toolchain risk that justifies a standalone E2E PR — each platform has an *independent* high-risk CI path: Android needs an emulator boot + the Gradle/JDK toolchain (RN 0.76 = JDK 17 + Gradle 8.x; the foojay-resolver / `IBM_SEMERU` trap only bites Gradle 9 + foojay-resolver < 1.0 — revisit if the framework version bumps), iOS needs a simulator + a WebDriverAgent build + code signing. The two also have *different CI shapes* (see ci-and-release.md): Android is a **single combined job** (the JS bundle couples to the APK at runtime, so scaffold→build→Metro→specs must agree on one project), iOS is **two-stage** (heavy `xcodebuild` build → artifact → a light E2E runner with a prebuilt WDA, to keep `xcodebuild` off the runner that boots the Appium session). Bundling both into one E2E PR doubles the flaky surface a single review has to stabilise, and a red iOS leg blocks an already-green Android leg. So split E2E **one PR per OS**, cheaper-runner platform first — Android on `ubuntu-latest` (KVM-accelerated, no macOS-runner cost) before iOS on `macos-latest`. This turns the 5-PR split into a **6-PR split** (PR4 E2E-Android → PR5 E2E-iOS → PR6 Ship); when iOS is a deliberate fast-follow you can frame it as PR4 + PR4.5 instead. Keep the e2e *fixture app* (one app, both platforms) in the Feature-Complete PR as usual — only the per-platform CI-build-and-run splits. If the framework needs an architecture matrix (RN's Paper + Fabric — framework-specific, not universal), it rides on **both** legs. **Gate each mobile E2E leg as required from its first PR** via the single aggregated "CI Status" check (so branch protection needn't change): consistent with the repo's no-allow-failure stance — a leg that can't be stabilised is *removed*, never left informational (the Electrobun precedent: Linux/Windows e2e dropped, not allow-failure). **Flag the user before opening the first mobile-CI PR** — it's the highest-risk leg and the platform-scope + gating call is theirs. (React Native is the worked example: Android-first required E2E, iOS sim + WDA as the fast-follow.)

The 6-PR split, mirroring the tables above:

| PR | Branch (off main) | Scope |
|---|---|---|
| **PR1–PR3** | `…-foundation` / `…-mvp` / `…-feature-complete` | As in the 5-PR split (fixture app for **both** platforms lands in PR3). |
| **PR4: E2E (cheaper runner)** | `feat/<service>-e2e-android` (off PR3) | Android emulator CI — a **single combined job** (ubuntu, KVM: scaffold native project → build APK → `adb reverse` → Metro → specs) + `_ci-e2e-<framework>.reusable.yml` + e2e specs + `wdio.<framework>.conf.ts` (android). Required gate. |
| **PR5: E2E (costlier runner)** | `feat/<service>-e2e-ios` (off PR4) | iOS simulator CI — a **two-stage** `_ci-e2e-<framework>-ios.reusable.yml` (macOS: `xcodebuild` build job → `.app` artifact; E2E job with a prebuilt WDA) running the same specs against iOS caps. Required gate. |
| **PR6: Ship** | `feat/<service>-ship` (off PR5) | Package-test fixture, full docs, complete CI gates, release pipeline. |

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
11. **(Mobile) `@wdio/appium-service` is a runner devDependency, not a service dep.** Compose it at `services: ['appium', '<framework>']` in the config; never add it to the service `package.json`. The service depends only on the `@wdio/native-*` packages + `webdriverio`.
12. **(Mobile/Hermes) `execute`/`mock` must be synchronous.** Hermes can't compile `async` source (Metro/Babel strips it before Hermes; the polyfilled `Promise` won't unwrap via CDP `awaitPromise`), so the eval wrapper — and user callbacks — are synchronous IIFEs. A Tier-1 channel over a different engine may not share this constraint; confirm in the spike.
13. **(Mobile) gate on the capability's platform, never `process.platform`.** One host drives both OSes over Appium. Read `platformName` / the service `platform` option so the launcher tests can exercise both branches.
14. **(Mobile/Hermes) the JS-realm inspector dies on backgrounding.** Connect **lazily** on first `execute`/`mock` (an eager warm-up in `before` races the engine's registration), and treat `connected` as a **liveness** check (`isOpen`) so a dropped socket reconnects — a backgrounded app suspends the inspector.
15. **(Mobile) the device-pool cursor must be monotonic.** Derive the round-robin index from a `nextIndex++`, not `claimed.size` — `size` shrinks on `release()` and would re-hand a freed index to a new worker while an earlier one still holds it.
16. **(Mobile/iOS CI) keep heavy `xcodebuild` off the E2E runner.** Pre-build WebDriverAgent into an explicit `derivedDataPath` (cap `appium:derivedDataPath` + `usePrebuiltWDA`); a per-session WDA xcodebuild on the same runner as the Appium session starves appium-xcuitest's SDK probe and drops the `POST /session` socket. Mirror the two-stage iOS workflow.
17. **(Mobile) `execute`/`mock` (and a self-rendered framework's find/tap) need an *instrumented, non-release* build.** The eval/finder channel only exists in a debug build: RN needs the Hermes debugger + Metro; Flutter needs the Dart VM Service + `enableFlutterDriverExtension()`. A release build has no channel — `execute`/`mock` silently have nothing to attach to. This shapes the fixture and the CI build step (build *debug*, expose the debug/VM port), so decide it in the spike, not late.

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
- **Mobile / Appium** — `packages/react-native-service/` + `e2e/wdio.react-native.conf.ts` + the two `.github/workflows/_ci-e2e-react-native*.reusable.yml`. The reference for any Appium-driven mobile service; the worked example of the **Hermes-CDP Tier-1** JS-realm sub-axis (caps mutation, device pool, contexts, `mobile: deepLink`, dual-arch E2E). Types: `packages/native-types/src/react-native.ts`.
- **Plan files** — `~/.claude/plans/<plan>.md`. Start every service with a plan capturing Strategy, Package layout, Phasing, Risks, Open decisions.
- **Spike findings** — `spike/FINDINGS.md`.
