# Native services — follow-up register

Deferred, cross-cutting work surfaced while building the WDIO native-app services. Items
here are **not** blockers for the PR that surfaced them — they're recorded so they don't get
lost in commit messages. Triage into GitHub issues at each service's ship (see
`.claude/skills/add-native-service/SKILL.md` → "Follow-up register").

This is distinct from the upstream-gap **umbrella issue** the skill describes: that tracks what
blocks the *current* service; this tracks what the current work leaves for *later*.

Status: ☐ open · ☑ done · ▷ has GitHub issue.

## Cross-service tech-debt

- ☐ **Mock-instance type bugs in `tauri.ts` / `electron.ts` (and siblings) — `@wdio/native-types`.**
  `react-native.ts` fixed two type errors it had inherited by mirroring `tauri.ts` (RN PR #337):
  `withImplementation` returned `Promise<unknown>` instead of `Promise<ReturnValue>` (discards the
  inferred generic), and `getMockImplementation()` was non-nullable (`AbstractFn`) where vitest's
  `Mock` returns `AbstractFn | undefined`. The Tauri — and likely Electron / Dioxus / Electrobun —
  mock-instance interfaces still carry both. A dead/unreachable second `execute` overload also exists
  in `tauri.ts`. _Trigger: RN PR #337. Fix as one small types-only PR across the services._

## Migrations

- ☐ **`@wdio/electron-service` → `@wdio/native-cdp-bridge`.** Electron still ships on its own
  `@wdio/electron-cdp-bridge`; migrate to the shared bridge at **10.2.0** (publish as `-next` first;
  not blocking). After the rename, verify *constructed* path forms, not just joined strings.
  _Trigger: PR #335 (shared-bridge extraction)._

## Upstream

- ☐ **Electrobun CEF profile-isolation umbrella issue.** File the upstream umbrella (gaps map to
  electrobun/CEF #380 / #445 / #448) and link it into webdriverio/desktop-mobile#320. Also verify the
  `@wdio/electrobun-service` `0.1.0` ReleaseKit release actually published. _Trigger: Electrobun #314 (shipped)._

## Deferred to a later RN PR / release

- ☐ **RN roadmap-doc refinements** — held for RN **PR5 (Ship)**: root `README` / `ROADMAP` / `AGENTS` /
  `CLAUDE` updates, including the spike-driven refinements deferred from the spike. _Trigger: RN spike._
  (Note: log capture, `emitEvent`, and `deviceManager`/multiremote are **in scope for RN PR3** by decision
  — not follow-ups.)

## Process / skill

- ☐ **Revise the `add-native-service` skill AFTER RN ships:** add the mobile archetype branch (3-way
  sub-axis: native-widget / VM-attach / webview-context), add `plumbing-appium.md`, encode the two-tier
  mock doctrine, and the mobile-fixture gotcha checklist (foojay/JDK, lifecycle/foreground, iOS locator
  rule, pod-install-from-ios). Ground in shipped RN; cross-check against the Flutter spike. _Trigger: RN build._
- ☐ **Wim Selles outreach** — peer-coordination DM (not permission-seeking), deferred until most of RN is
  built; finalize the draft with real service + DX examples at send. _Trigger: RN build._
