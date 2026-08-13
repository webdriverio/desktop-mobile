# 3. New services copy the reference implementation; shared code is extracted only on the Rule of Three

Date: 2026-08-03

## Status

Accepted — retroactively documenting the cancellation of the `@wdio/native-utils` base-class
layer (late 2025) and the reuse discipline adopted since. Still governs which packages share
code today.

## Context

After the Electron service shipped, the plan for reuse was a shared-core package
(`@wdio/native-utils`) that every future service would inherit: `BaseLauncher` / `BaseService`
lifecycle base classes plus generic utilities (binary detection, a config reader, window
management).

It was actually built — roughly 1,241 lines with 125 passing tests, all green in isolation.
Then it was integrated back into its one real consumer, the Electron service, and the result
was worse than before:

- Electron's launcher + service went from ~572 to ~615 lines (**+43 lines, +7.5%**) — the base
  classes produced type-casting and wrapper boilerplate, not shared implementation.
- The concrete utilities went **unused**, because Electron already had working, tested,
  framework-specific versions and retrofitting them added risk for no gain.

The diagnosis was textbook premature abstraction: generalising from a *single* implementation
(YAGNI), reaching for inheritance over composition, and designing for hypothetical future
services instead of proven duplication.

## Decision

Delete the heavyweight `@wdio/native-utils` base-class layer. Adopt a **copy-first** rule:

- A new service **copies** proven patterns from the reference implementation (Electron for
  desktop) and adapts them, rather than inheriting a framework.
- Shared code is **extracted into a package only after the pattern appears in ~3 places** (the
  Rule of Three), and even then favours **composition** (utility functions) or a **minimal
  shared-state base** over a behaviour-heavy inheritance framework.
- `@wdio/native-utils` survives only as small, opt-in composition helpers (e.g. `createLogger`),
  not a base-class framework.

## Consequences

- The desktop services copy-and-adapt their **framework-specific** launcher and worker logic;
  some duplication is accepted as the price of framework clarity and looser coupling. Electron
  and Tauri own their launchers outright; Dioxus and Electrobun extend a small shared base (next
  point) for the mechanical lifecycle only.
- **Two narrow base classes were later earned by this exact rule — one per platform:**
  - **Mobile** — once React Native *and* Flutter both demonstrated the duplication, the shared
    Appium layer was extracted into `@wdio/native-mobile-core`, which RN and Flutter genuinely
    extend.
  - **Desktop** — `@wdio/native-core` exposes a deliberately minimal `BaseLauncher`: just shared
    launcher *state* (a `PortManager` for driver ports, a `DriverPool` for tracking driver
    subprocesses, and a `stopAllDrivers()` teardown helper). Dioxus and Electrobun extend it;
    Electron and Tauri do not. This is **not** the rejected `@wdio/native-utils` layer — it shares
    only port/process/teardown plumbing, forces nothing onto the reference implementations, and
    subclasses still own every WDIO hook and all framework-specific behaviour.
- So **"copy-first" governs framework-specific launcher/service logic, not the mechanical
  port/process/teardown lifecycle.** A new desktop service that spawns a driver subprocess should
  **extend `native-core`'s `BaseLauncher`** rather than re-implement that plumbing, and
  copy-and-adapt the framework-specific parts around it.
- A contributor tempted to extract a base class for *all* services should still read this record
  first: that universal-inheritance path (`@wdio/native-utils`) was tried, cost several weeks, and
  was reverted. The bar is demonstrated duplication, not anticipated duplication — which is why the
  two narrow bases above exist and a universal one does not.
