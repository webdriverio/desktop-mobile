# Feature inventory — converge on one surface

**Guiding principle: every service should expose as close to an identical API and feature surface as possible.** A user who knows `@wdio/electron-service` should be able to move to `@wdio/tauri-service`, `@wdio/react-native-service`, or a new service with minimal relearning. Mocking is the template — it's already standardised across every service, and new features should be designed the same way: one shape, same method names, same option names, same semantics.

So the default answer to "should this service have feature X?" is **yes, with the same surface as the others**. You only omit a standard feature when the framework genuinely lacks the underlying concept — and then you document it as a known gap, not a design choice. Framework-specific work is *additive* (extra methods on top of the shared surface), never a divergent reinvention of something that already has a standard shape.

## The standard `browser.<framework>.*` surface

| Method | Standard? | Electron | Tauri | Dioxus | React Native |
|---|---|---|---|---|---|
| `execute(script, …args)` | ✅ every service | ✅ | ✅ | ✅ | ✅ |
| `mock(target)` | ✅ every service | ✅ | ✅ | ✅ | ✅ |
| `clearAllMocks` / `resetAllMocks` / `restoreAllMocks` | ✅ every service | ✅ | ✅ | ✅ | ✅ |
| `isMockFunction` | ✅ every service | ✅ | ✅ | ✅ | ✅ |
| `triggerDeeplink(url)` | ✅ every service | ✅ | ✅ | ✅ | ✅ |
| `switchWindow` / `listWindows` | ✅ standard multi-window API | ⚠️ gap¹ | ✅ | ✅ | ✅ contexts³ |
| `emitEvent(...)` | ✅ where an event bus exists | ✅ | ✅ | ⚠️ gap² | ✅ ⁴ |
| `mockAll(apiName)` / class mock | extension (object-API frameworks) | ✅ | — | — | — |

¹ Electron currently exposes `windowHandle` + automatic window focus instead of `switchWindow`/`listWindows`. Treat this as a **known divergence to converge**, not a template — a new multi-window service should implement `switchWindow`/`listWindows` (the Wry standard).
² Dioxus has no event bus today, so it omits `emitEvent`. Documented gap, not a deliberate exclusion.
³ React Native realises `switchWindow`/`listWindows` over **Appium contexts** (`NATIVE_APP` ↔ `WEBVIEW_*`) — the cleanly-converged form of the same surface Electron still diverges from. Same API, mobile semantics.
⁴ React Native's `emitEvent` drives RN's `DeviceEventEmitter` over the Hermes JS-realm bridge.

## Mocking — the two-tier doctrine

Mocking is always the **same Vitest-like surface** (`mock`, `clearAllMocks`, `resetAllMocks`, `restoreAllMocks`, `isMockFunction`) with the two-process inner/outer split (inner intercepts in-app, outer for assertions, one-way `update()` sync). What varies by framework is only the *inner* mechanism — two tiers:

- **Tier 1 — transparent JS-eval injection.** The service rewrites the target function in the app's scripting realm through an eval channel: a `@wdio/native-spy` outer mock in the test process + an inner script-builder recorder installed into the realm. Used by every desktop service (CDP `Runtime.evaluate` / Wry `execute`) **and** React Native (Hermes via Metro inspector, recorder under `globalThis.__WDIO_RN_MOCKS__`). The app needs no cooperation — the eval channel is enough.
- **Tier 2 — cooperative opt-in contract.** When the target can't be **transparently rewritten in place** (the channel can run code but offers no monkeypatch seam), the app/fixture exposes named hooks the test toggles (mock baked in, opt-in). This is Flutter's path: the Dart VM Service has an `evaluate` RPC but no in-place function replacement, so the *fixture* cooperates for `mock`. It's a **`mock`-only** boundary — **`execute` still works**, over that same `evaluate` RPC. Proven in the Flutter spike.

**Decision rule:** *can you transparently rewrite the target through an eval channel?* Yes → Tier 1; no → Tier 2 (an eval channel may still exist for `execute` — e.g. Dart's `evaluate` RPC — it just can't monkeypatch). This is a **`mock`-mechanism** split only; the user-facing surface is identical either way — never invent a different mocking idiom. See `agent-os/standards/global/mock-architecture.md` for the inner/outer split.

## Mobile reinterpretations of the standard surface

Mobile ships the **same** Tier-1 standard surface, re-expressed in Appium terms (none of these is a new idiom — match the existing method/option names):

- **`switchWindow` / `listWindows` = Appium contexts.** `getContexts()` (normalised to id strings — Appium 2 returns plain strings *or* `{ id }` objects) and `switchContext`, over `NATIVE_APP` ↔ `WEBVIEW_*`. The mobile realisation of the multi-window surface.
- **`triggerDeeplink` = `mobile: deepLink`** (both drivers, since Appium 2) reading `appium:appPackage`/`appium:bundleId`; Android falls back to `mobile: shell` `am start` where the driver lacks `mobile: deepLink`. Contrast the desktop OS-protocol spawn (`rundll32`/`open`/`xdg-open`) — mobile does not use it.
- **Log capture = two channels under `captureBackendLogs`.** Native device logs (`getLogs('logcat'|'syslog')`, drained per-`afterTest` so lines attribute to the test) **plus** JS console over CDP `Runtime.consoleAPICalled`. Same gate, two sources.
- **Multiremote + per-worker parallelism = a device pool.** Where Wry services give each worker its own driver/port via `PortManager`/`DriverPool`, mobile claims one device per worker round-robin from a configured pool (`DeviceManager`). Same universal feature, mobile mechanism — **but only the per-worker parallelism is real today; full multi-device *multiremote* (N devices + a per-instance channel) is a first-ship gap (#446; see the Tier-1 bullet above and SKILL.md gotcha 19).**
- **Find/tap is NOT uniform across mobile** (the one place mobile *doesn't* converge cleanly). A **native-widget** framework (RN) surfaces `testID` as `accessibilityId`/`resource-id`, so standard `browser.$` just works and the service adds nothing. A **self-rendered** framework (Flutter) paints a canvas its widgets don't reach the native a11y tree from — find/tap goes through the framework's own finder protocol (Flutter: `ByValueKey`/`ByText` in the `FLUTTER` context), and `getText` needs normalising (iOS `value` vs Android `text`). This is the Step 0 "sub-axis 1" split; the service may absorb the finder/context boilerplate but the mechanism stays framework-specific.

## Tier 1 — Standard surface (implement the same shape in every service)

These are the baseline. Match method names, option names, and semantics to the existing services exactly.

- **`execute(script, …args)`** — run a function in the app context with the framework API handle injected. CDP: `Runtime.evaluate`/`callFunctionOn`; Wry: WebDriver `execute` / the bridge `wdio://` invoke.
- **Mocking** — the canonical example of standardisation. Vitest-like surface (`mock`, `clearAllMocks`, `resetAllMocks`, `restoreAllMocks`, `isMockFunction`) over `@wdio/native-spy`, with the two-process inner/outer split (inner intercepts in-app, outer for assertions, one-way `update()` sync). New services reuse this design wholesale; the *inner* mechanism comes in two tiers (see "Mocking — the two-tier doctrine" above) — see also `agent-os/standards/global/mock-architecture.md`. Do not invent a different mocking idiom.
- **Deeplink / protocol testing** — `triggerDeeplink(url)`; OS-level trigger (`rundll32`/`xdg-open`/`open`) is portable, only the app-side handler differs.
- **Multi-window** — `switchWindow(label)` / `listWindows()` is the standard. Wry tracks a label registry in the bridge (`window_state`); a CDP service maps it onto CDP targets. Implement this shape whenever the framework has addressable windows/targets.
- **Log capture** — backend (main/native) + frontend (renderer/webview), gated by `captureBackendLogs` / `captureFrontendLogs` with per-stream level options. `logForwarder`/`logParser` stay framework-local (formats differ); only `shouldLog` is shared.
- **Browser mode** — test the frontend in plain Chrome against a dev server; launcher detects `mode: 'browser'` and skips binary/driver setup.
- **Standalone / session mode** — `session.ts` exporting `create<Framework>Capabilities`, `startWdioSession`, `cleanup`. Same trio in every service.
- **Multiremote + per-worker parallelism** — **universal.** Every service supports driving multiple app instances at once and parallel workers. Wry services give each worker its own driver/port via `@wdio/native-core`'s `PortManager`/`DriverPool`; CDP services attach per-instance. Handle both the array-caps and multiremote-record caps shapes in the launcher (see `dioxus-service/src/launcher.ts` `prepareEmbedded` vs `prepareEmbeddedMultiremote`). **Mobile caveat:** the RN/Flutter launchers currently only capability-shape-*parse* multiremote — one device is stamped across every instance, and neither worker has an `isMultiremote` branch — so real multi-device routing (N devices/worker + a per-instance JS-realm channel) is a deferred first-ship gap (#446; SKILL.md gotcha 19). Per-worker parallelism (the device pool) *is* real; multi-device *multiremote* is not yet.
- **Headless / CI execution** — **universal.** Every service must run headless on CI across all supported platforms — services exist to run in CI. Windows and macOS need no special handling; Linux needs a virtual display. **WDIO provides this, not the service**: the `@wdio/xvfb` package (being renamed `@wdio/display-server` in WDIO v10) plus the `autoXvfb` config option start an Xvfb display for the **worker** process. CDP services (e.g. Electron) set `autoXvfb: true` and rely on it directly. **Wry services need a different approach**: their driver runs in the **launcher** process (not the worker) and needs the display *before* the worker starts, so worker-level `autoXvfb` doesn't cover it — they set `autoXvfb: false` and wrap the entire test command in `xvfb-run` in CI (see `e2e/wdio.tauri.conf.ts` / `e2e/wdio.dioxus.conf.ts`). `@wdio/display-server` is expected to manage this launcher-process case too once released. Headless-on-all-supported-platforms is the target; the mechanism is the above (and evolving), not something the service implements itself.
- **Config option naming** — keep user-facing options consistent across services (`appBinaryPath`/`application`, `captureBackendLogs`, `mode`, `devServerUrl`, etc.). A new option that has an analogue elsewhere should reuse the existing name.
- **Zero-config setup / toolchain-lifecycle ownership** — DX parity is standard: `@wdio/electron-service` auto-manages Chromedriver so the user configures nothing, and every service should drive as much of its own setup as feasible (**opt-in, idempotent**). Shipped: mobile auto-installs the Appium driver against a server↔driver version matrix, allocates the per-worker realm port, and runs a **preflight doctor** that fails fast with actionable toolchain errors instead of a cryptic Appium timeout (`ensureAppiumDriver`/`autoInstallDriver`, #378); RN owns the Metro dev-server lifecycle (#406); Flutter auto-allocates `dartVmServicePort` (#405); the desktop analog is browser mode's `devServerCommand` auto-start (#417). Skip where there's no canonical toolchain to manage — the *goal* (the user configures nothing) is the standard, the mechanism is framework-specific.

## Tier 2 — Conditional only on the framework having the concept

Still aim to ship these with the standard surface; the *only* gate is whether the framework has the underlying capability. If it does, match the existing API; if it doesn't, record a documented gap.

- **`emitEvent`** — implement it (matching Electron/Tauri's shape) when the framework has an event bus. Omit + document only if it has none (Dioxus).

## Tier 3 — Framework-specific (additive extensions and internal mechanisms)

These are genuinely bound to one framework's model. They sit *on top of* the shared surface — they never replace a standard API. Build an analogue only if your framework has the same concept.

- **API-surface extensions**: Electron `mockAll(apiName)` + class mocking (`classMock.ts`, `mockFactory.ts`) — richer because Electron exposes object/class APIs, not a single invoke bus. The core `mock()` lifecycle is still the standard; this is extra.
- **Provider/driver mechanisms**: Tauri's CrabNebula provider + Edge WebDriver management; Dioxus's embedded WebDriver server crate + `wdio://` bridge IPC. Internal plumbing, not user-facing API.
- **Platform/runtime specifics**: Electron fuses (`fuses.ts`), AppArmor (`apparmor.ts`), Chromedriver version matching (`electronVersion.ts`).
- **Auto binary-path detection** — the *mechanism* is framework-specific (Electron reads Forge/Builder config), but the *user-facing option* (`appBinaryPath`/`application`) is standard. Port auto-detection only when the framework has one canonical build tool with a stable output layout; otherwise expose the standard explicit-path option and skip the detection machinery (guessing wrong is worse than asking — see #295/#303 for the case study). The *API stays consistent* either way.

## Not service features (docs only)

**Visual regression testing and video recording are not features of any service here** — and not something to implement. They're demonstrated in the `docs/` set as *usage examples* showing how a service composes with **third-party WDIO packages we don't control** (e.g. `@wdio/visual-service`, `wdio-video-reporter`). They work because the service produces a standard WebdriverIO session, not because of any code we ship. Include the demonstrating docs in a new service's doc set, but never list them as service features or build anything for them.

## Applying this to a new service

Whatever the archetype, ship the **entire standard surface** (Tier 1) matching the existing method and option names — execute, mocking, deeplink, multi-window, log capture, browser mode, standalone, multiremote, plus headless. Then:

- **Multi-window/targets**: implement `switchWindow`/`listWindows`. For a CDP framework with multiple addressable targets (per-tab/OOPIF webviews), realise this surface over those targets — same API, mapped onto target routing, not a new idiom.
- **`emitEvent`**: include it if the framework exposes an event bus; otherwise document the gap.
- **Auto binary detection**: implement the *mechanism* only if the framework has one canonical build tool with a stable output layout; otherwise expose the standard explicit-path option (`appBinaryPath`/`application`) and skip detection. The user-facing API stays the same either way.
- **Don't reinvent**: mocking, execute, and log capture come straight from the shared design — copy the shape.
- **Don't port** (Tier 3): another framework's platform/runtime specifics (Electron fuses/AppArmor/Chromedriver-versioning, Tauri CrabNebula, Dioxus bridge crate) unless your framework has the same concept.
