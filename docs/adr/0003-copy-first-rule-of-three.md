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

Delete the inheritance / base-class layer. Adopt a **copy-first** rule:

- A new service **copies** proven patterns from the reference implementation (Electron for
  desktop) and adapts them, rather than inheriting a framework.
- Shared code is **extracted into a package only after the pattern appears in ~3 places** (the
  Rule of Three), and even then favours **composition** (utility functions) over inheritance.
- `@wdio/native-utils` survives only as small, opt-in composition helpers (e.g. `createLogger`),
  not a base-class framework.

## Consequences

- The desktop services (electron, tauri, dioxus, electrobun) copy-and-adapt; each owns its own
  launcher and worker service. Some duplication across them is accepted as the price of
  framework-specific clarity and looser coupling.
- **The extraction that *was* earned came later, by this exact rule.** Once React Native *and*
  Flutter both existed and demonstrated the duplication, the shared Appium layer was extracted
  into `@wdio/native-mobile-core`, which RN and Flutter genuinely do extend. Two mobile services
  justified a base class; one desktop service did not.
- A contributor tempted to "extract a base class for all services" should read this record
  first: that path was tried, cost several weeks, and was reverted. The bar is demonstrated
  duplication, not anticipated duplication.
