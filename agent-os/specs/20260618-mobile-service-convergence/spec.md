# Specification: Generic `@wdio/mobile-service` & Mobile-Service Convergence

> **Status:** 📋 Planned (design) — 2026-06-18 (updated 2026-07-01: E2E strategy, convergence-subsumes-gaps, versioning guidance)
>
> **Companion work (tracked as issues, not restated here):**
> - [#378](https://github.com/webdriverio/desktop-mobile/issues/378) — shared mobile setup automation in `@wdio/native-mobile-core`
> - [#405](https://github.com/webdriverio/desktop-mobile/issues/405) — Flutter zero-config (`dartVmServicePort`)
> - [#406](https://github.com/webdriverio/desktop-mobile/issues/406) — React Native Metro/Hermes
> - [#508](https://github.com/webdriverio/desktop-mobile/issues/508) — Phase-0 spike: the generic E2E fixture (native-widget + webview, both OSes)
>
> This spec is **focused** on the generic service + the convergence refactor. The setup-automation
> mechanics (Tier 1/2/3) live in the issues above and are referenced, not duplicated.
>
> **Depends on** the setup-automation track landing in `@wdio/native-mobile-core` first.

---

## Goal

Promote the framework-agnostic mobile layer (`@wdio/native-mobile-core`) into a concrete,
publishable **`@wdio/mobile-service`** usable for any Appium-drivable app, and converge the
React Native and Flutter services onto it as **thin extensions** that add only their
JS/Dart realm (`execute`/`mock`).

## User Stories

- As a native-app (Kotlin/Swift) tester, I want a zero-config WebdriverIO mobile service so I get
  Appium driver install, device boot, and a preflight doctor without hand-wiring a custom service.
- As a NativeScript / .NET MAUI / Capacitor-shell tester, I want the same mobile service to drive my
  app via Appium, since I have no framework-specific JS/Dart realm to mock.
- As a maintainer, I want RN and Flutter to share one concrete mobile base so the shared API
  (deeplink, context switching, logs, multiremote) is defined once and reviewed in one place.
- As a future-framework author (Capacitor), I want to extend a stable generic base rather than
  re-implement the mobile scaffold.

## Background & Motivation

- **`native-mobile-core` is already framework-agnostic, but it is a *library*** (a base launcher +
  standalone helper functions), not a service a user can name in `services: [...]`. A generic
  `@wdio/mobile-service` is its first concrete, publishable face.
- **`@wdio/appium-service` is strictly server-lifecycle** — it spawns/waits/kills the Appium server,
  picks the server port (`get-port`, default 4723), and injects connection caps only
  (`protocol`/`hostname`/`path`/`port`). It does **no** driver install, **no** device management,
  **no** cap derivation, and **no** doctoring (evidence: `wdio-appium-service/src/launcher.ts`). A
  mobile service is therefore **complementary**, not duplicative.
- **RN and Flutter already diverge on shared helpers** — `react-native-service` imports
  `switchContext`/`listContexts`/`triggerDeeplink` from its **local** `./commands/*`, while
  `flutter-service` imports the same-named helpers from `@wdio/native-mobile-core`. A concrete base
  removes that drift and serves the service-API-convergence goal directly.
- **RN is already "generic + Hermes."** RN drives native UI with UiAutomator2/XCUITest — the same
  drivers a plain native app uses — and only adds the Hermes channel for `execute`/`mock`. Flutter is
  the outlier: it swaps the Appium driver (`automationName: 'Flutter'`) and adds the Dart VM. So the
  generic base composes almost literally under RN, and under Flutter once the launcher allows an
  `automationName` override (which it should regardless).

## Scope

### In scope
- **`@wdio/mobile-service`** — a concrete launcher (consuming the #378 setup automation) + a
  `MobileService` worker exposing the shared API: deeplink, context switching, device logs, native
  find/tap via Appium, multiremote/DeviceManager.
- **Convergence** — `react-native-service` and `flutter-service` extend the concrete base and add
  **only** their realm bridge (Hermes / Dart VM) plus framework specifics (Flutter `automationName`,
  finders).
- **The `execute`/`mock` dividing line** — a generic native app has no JS/Dart realm, so the generic
  service omits realm-level `execute`/`mock`; API types are segregated so it does not advertise them.
- **Foreign-cap no-op guard** — each service ignores caps that are not its own (by
  `automationName` / custom-capability marker), the prerequisite for mixed multiremote fleets.
- **The mobile first-ship gaps are resolved *in the base*.** Standalone E2E + the standalone contract
  ([#445](https://github.com/webdriverio/desktop-mobile/issues/445)), real multi-device multiremote
  ([#446](https://github.com/webdriverio/desktop-mobile/issues/446)), and deeplink nav-proof + CI gate
  ([#457](https://github.com/webdriverio/desktop-mobile/issues/457)) — currently open against RN/Flutter
  — become **base concerns fixed once**, not twice per framework, since the base is where the shared
  surface (deeplink / contexts / logs / multiremote) is defined. Converging is the natural place to
  close all three; treat them as part of this work, retargeted onto `@wdio/mobile-service`.
- **Preserve the published framework surfaces — no breaking change.** RN and Flutter already ship
  `browser.reactNative.*` / `browser.flutter.*` on the `next` tag. Convergence keeps those exact
  namespaces — the base's shared commands surface *through* them (the framework service "widens" its own
  namespace, per Architecture) — rather than moving users onto `browser.mobile.*`. `browser.mobile.*` is
  the primary surface **only** for the standalone generic service. This is a hard backward-compat
  constraint on the rework and shapes the `native-types` augmentation.

### Out of scope
- The setup-automation mechanics (Tier 1/2/3) — see #378/#405/#406.
- Webview-context `execute` for Capacitor — a future Capacitor-service concern, not part of the generic base.
- Any change to `@wdio/appium-service`'s server-lifecycle responsibilities.

## Architecture

```
@wdio/native-mobile-core (library)
  └─ @wdio/mobile-service            launcher: #378 setup automation
                                     worker:   MobileService (shared API)
       ├─ @wdio/react-native-service  + Hermes realm (execute/mock); native driver unchanged
       └─ @wdio/flutter-service       + Dart VM realm (execute/mock); automationName 'Flutter'
```

- A concrete `MobileService` **worker base** wires the shared API once; framework workers extend it
  and install only their realm-backed commands.
- API-type segregation: `MobileService` exposes native/deeplink/context/log/find APIs; the
  framework services widen the surface with their realm-backed commands — `execute`, `mock`, and the
  existing `emitEvent` event-bus command (RN and Flutter already expose all three today).
- Inheritance is one extra level vs today (core lib → concrete service → framework service). The
  alternative — composition (framework worker holds a `MobileService` instance) — is acceptable if a
  3-level class chain proves awkward; decide during implementation.
- **Multiremote splits across the base/framework boundary.** The base owns N-distinct-device
  allocation (`DeviceManager`) and per-instance attachment of the *shared* API; a framework extension
  owns the per-instance *realm* channel (Hermes target-per-device / Dart-VM-per-udid). The base worker
  must therefore expose a **seam for a subclass to attach a per-instance realm bridge** — a hard
  constraint on the inheritance-vs-composition choice above, and the base half of #446.

## Composition / Configuration Model

| Config | Meaning | Verdict |
|---|---|---|
| `['appium', '<framework>']` | appium server explicit; mobile layer inherited inside the framework service | ✅ Recommended (= today's model) |
| `['appium', 'mobile-service']` | standalone generic native testing | ✅ Supported |
| `['<framework>']` | framework auto-manages the appium server *when local* | 🟡 Future polish (more magic; appium-service already no-ops on cloud caps) |
| `['appium', 'mobile-service', '<framework>']` | both register the shared layer | ❌ Double-registration |

- **The shared layer is inherited, not listed.** Listing `mobile-service` next to a framework service
  double-registers the launcher/worker (device claimed twice, caps mutated twice, doctor run twice).
- **`appium` stays explicit** so cloud/remote (BrowserStack, Sauce, remote Appium) is a clean swap:
  omit `appium-service`, set connection caps. The framework service *validates* presence (per #378
  Tier 2) rather than forcing a local server.
- **Multiple framework entries** are correct only for a genuinely **mixed multiremote fleet**
  (some Flutter, some RN, some native) — and only if the foreign-cap no-op guard holds.

## Relationship to `@wdio/appium-service` (and an upstream question)

- **No overlap with appium-service's current scope.** Compose, don't duplicate; never spawn the
  Appium server or pick the server port from the mobile service. The device-side realm ports #378
  allocates (`dartVmServicePort`, Metro) are a different concern — no conflict.
- **Defer to WDIO core's existing `browser.*` mobile commands** (~49 of them: `tap`, `swipe`,
  `switchContext`, `getContexts`, `launchApp`, `lock`, …) rather than re-wrapping them. The mobile
  service's value is setup automation + the normalized, cross-service-consistent API shape + deeplink
  fallback + log forwarding.
- **Upstream candidate — deferred until after the mobile-service ships.** Driver auto-install + the
  version matrix + the doctor are generic enough to benefit *every* Appium user, so they are a candidate
  to **propose upstream into `@wdio/appium-service`** rather than maintain in parallel. **Decision:** do
  **not** pursue this until after `@wdio/mobile-service` is released, and gate it on two questions first:
  (1) does upstreaming complicate *our* maintenance (a fork/version-lag dependency, split ownership)?
  and (2) does it dilute the value of our services by handing our differentiator to a base everyone gets
  for free? Only open the maintainer (Wim) peer-coordination conversation if both answers are
  comfortable. Until then, keep these in `native-mobile-core`.

## Testing & E2E strategy

- **Standalone is the base's *primary* mode**, so its E2E is first-class — not the deferred afterthought
  it was for RN (#445). Prove real behaviour against a device (navigation asserted, session exercised),
  not a smoke test. When the base is **wrapped**, its API is exercised transitively by the RN/Flutter
  suites; the *net-new* E2E investment is specifically the **standalone-generic** path.
- **The generic fixture must prove two independent axes** no trivial app covers together: native-widget
  find/tap (the core), and `NATIVE_APP` ↔ `WEBVIEW_*` context switching — plus deeplink (scheme +
  handler), device logs, and multiremote. It must be **neither RN nor Flutter** (their own fixtures),
  ideally one cross-platform codebase on both OSes.
- **Fixture technology is an open Phase-0 decision — spike
  [#508](https://github.com/webdriverio/desktop-mobile/issues/508).** Candidates: **.NET MAUI** (the
  marquee generic-service target per `ROADMAP.md` → dogfooding, but heavy .NET/Xcode CI),
  **NativeScript** (lighter), or **plain native** (two codebases); **not** Blazor Hybrid (`ROADMAP.md`:
  Hybrid webview context switching unreliable). Decide by building a minimal both-axis fixture and
  measuring green-on-both-OSes + CI cost.

## Skill applicability — reuse the mechanics, skip these default motions

The `add-native-service` skill is the right **mechanics checklist** for this build (Appium plumbing, CI
shape, fixtures, tests, release). But this service is a **base/substrate**, not a leaf framework
service, so several of the skill's *default motions do not apply* — a plan must consciously skip them:

- **Extract-up, not clone-a-sibling.** The build *promotes* an existing library (`native-mobile-core`),
  most of which already exists — it is not a fresh clone of RN.
- **A base, not a leaf.** Design the worker for subclassing (the per-instance realm-bridge seam;
  inheritance-vs-composition) — the skill's leaf-worker model doesn't cover this.
- **Convergence is inverted.** This service *defines* the shared surface others converge onto; building
  it is as much a **refactor of RN/Flutter** as a new build.
- **`execute`/`mock` are deliberately *omitted*.** The skill's "every service ships execute + mock" is
  inverted here — the generic base has no realm; those are the framework extensions.
- **Standalone *and* wrapped** is a composition contract the skill doesn't model (the config table
  above: no double-registration; foreign-cap no-op guard).
- **Version coupling** (a JS base ↔ its published consumers), not the skill's Rust npm↔crate lockstep.

The skill's Mobile archetype is updated to *reflect* this base **only after it ships** (Sequencing step
4) — never edit it against this not-yet-built abstraction.

## Sequencing

1. **Setup-automation track lands** in `native-mobile-core` (#378 → #405/#406).
2. **Extract the concrete `MobileService` worker base; converge RN + Flutter.** This is the
   highest-leverage step and is worth doing *even if a standalone generic service is not published* —
   it removes the existing RN/Flutter divergence. **It is also the project's biggest risk: reworking two
   *published* (`1.0.0-next`) services onto a new base. Gate it — the RN *and* Flutter unit + E2E suites
   stay green throughout — and do it as a *dedicated* rework step, not interleaved with new features
   (the same extraction discipline that governed the original `native-mobile-core` extraction).**
3. **Publish `@wdio/mobile-service`** (generic native) — the base that Capacitor extends.
4. **Distill the converged mobile archetype back into the `add-native-service` skill**
   (`.claude/skills/add-native-service/` — the Mobile archetype + `plumbing-mobile.md`): a new mobile
   framework should extend `@wdio/mobile-service` rather than clone RN/Flutter. This is an **output of
   completion, not a prerequisite** — the skill encodes *proven* patterns, so it is updated only once
   the base ships and is validated, never against the not-yet-existent abstraction (same reason the
   skill was revised only after React Native shipped). **Required deliverable** of this work.

## Open Questions

- ~~Upstream driver-install/doctor to `@wdio/appium-service`, or keep in `native-mobile-core`?~~
  **Decided:** defer until after the mobile-service release; gate on maintenance-cost + service-value
  dilution (see "Relationship to `@wdio/appium-service`").
- Versioning: a `@wdio/mobile-service` `1.0` line vs the RN/Flutter `1.0.0-next.x` lines. **Guidance
  (version-honesty rule):** the base graduates to `1.0` only when its Tier-1 surface is *proven* —
  including standalone E2E (#445), real multiremote (#446), and deeplink nav-proof (#457). Until then it
  stays `0.x` / `-next`; a `1.0` base sitting on shape-only multiremote would overclaim.
- Inheritance vs composition for the worker base (decide at implementation).
