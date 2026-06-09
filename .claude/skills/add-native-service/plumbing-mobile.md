# Phase 2 — Mobile / Appium plumbing (React Native, Flutter, Capacitor)

For apps installed on a device/emulator/simulator and driven by **Appium** (UiAutomator2 on
Android, XCUITest on iOS) over W3C WebDriver. Unlike the desktop archetypes, **the service does NOT
spawn the app or a driver** — WDIO's `@wdio/appium-service` boots the Appium server and Appium
launches the app from capabilities. There is **no Rust, no driver crate, no `<framework>:options`
capability, and no `<FRAMEWORK>_WEBVIEW_AUTOMATION` env var**. The shipped reference is
`@wdio/react-native-service` (`packages/react-native-service/`).

## What you build

| Piece | Where | Job |
|---|---|---|
| Launcher | `src/launcher.ts` (extends `BaseLauncher`) | capability mutation in `onPrepare`; device claim/release in `onWorkerStart`/`onWorkerEnd`. No `onComplete` driver teardown. |
| Capability prep | `src/capabilities.ts` | per-platform `appium:automationName`; `appBinaryPath`→`appium:app`; platform validation (`SevereServiceError`) |
| Device pool | `src/deviceManager.ts` | round-robin `claim(cid)`/`release(cid)` + `applyToCapability()` |
| JS-realm channel | sub-axis specific (below) | `execute` / `mock` |
| Converged commands | `src/commands/*` + `src/logCapture.ts` | contexts, deeplink, logs — the standard surface, mobile-flavoured |

The launcher only mutates the caps WDIO hands it; the worker (`service.ts`) installs
`browser.<framework>.*` in `before` and attaches the JS-realm channel.

## Appium composition + capability mutation

- **Compose at the runner, not in the package.** The config lists `services: ['appium', '<framework>']`
  (`@wdio/appium-service` boots the server; your service prepares caps + attaches the JS-realm
  bridge). `@wdio/appium-service` is an **e2e/runner devDependency**, *not* a dependency of the
  service package — don't add it to `package.json` (see gotcha). The service depends only on the four
  `@wdio/native-*` packages + `webdriverio`.
- **Per-platform automation name.** `capabilities.ts` sets `appium:automationName` from a
  `{ android: 'UiAutomator2', ios: 'XCUITest' }` map and maps the service `appBinaryPath` option onto
  `appium:app` *only when no launch cap is already set* (prefer the explicit `appium:*` launch cap).
- **Gate on the capability's platform, never `process.platform`** (`prepareReactNativeCapability`):
  read `platformName` (or the service `platform` option), `.toLowerCase()`, throw a
  `SevereServiceError` (`unsupportedPlatform`) otherwise. One host drives either OS over Appium, and
  keeping the discriminator on the cap lets the launcher tests exercise both branches.
- **Standalone mode** (`session.ts`): `remote()` runs only worker hooks, so the standalone path must
  invoke the launcher's cap-prep itself, and defaults the Appium connection to `localhost:4723/`
  (not WDIO's `:4444`).

## Device pool (parallel workers / multiremote)

`DeviceManager` (`deviceManager.ts`) distributes a configured `devices` list across workers:
- **Monotonic cursor.** Allocate from a `#nextIndex++ % devices.length`, **NOT** from
  `claimed.size` — `size` shrinks on `release()` and would re-hand a freed index to a new worker
  while an earlier one still holds it.
- One device per worker; a multiremote worker shares its one device across instances
  (distinct-device-per-instance would need N-per-cid, not implemented).
- Empty/unconfigured pool = **no-op**: the cap is used as-is and Appium picks the device.
- `applyToCapability(cap, device, platform)` sets `appium:udid` (Android emulator serial) or
  `appium:avd` (AVD name) on Android, and `appium:udid` (from `iOSUdid`) on iOS.

## The JS-realm sub-axis — how `execute`/`mock` reach the scripting realm

The native UI is always Appium. This sub-axis is *only* about the eval/mock channel. Pick the point
that matches the framework's engine (confirm in the spike):

### Hermes / CDP (React Native) — Tier 1, worked detail

RN runs JS in Hermes behind **Metro's inspector-proxy**, which speaks CDP — so RN reuses the shared
`@wdio/native-cdp-bridge` `CdpBridge` rather than inventing a transport:

- **`createHermesBridge`** (`hermesBridge.ts`) wraps `CdpBridge` with two RN specifics: a Hermes
  **target selector** and a Fusebox **`Origin` header**.
  - `selectHermesTarget` (`hermesTarget.ts`) picks the live target from `/json/list`: prefer a
    connectable entry whose title/description matches `/hermes|react native/i`, and within that take
    the **last** (newest registration — the live page is appended after a reload).
  - `metroOrigin(host, port)` returns `http://<host>:<port>` (IPv6 bracketed) — Fusebox's
    `verifyClient` CSRF check rejects WebSocket upgrades whose `Origin` ≠ the proxy's own base URL.
- **`MetroBridge`** (`metroBridge.ts`) is the lifecycle wrapper: best-effort Android
  `adb reverse tcp:8081 tcp:8081` (forwards the device's Metro port to the host), **lazy +
  single-flight `connect()`** (concurrent first-use callers share one in-flight connect via
  `#connecting` so a loser socket isn't orphaned), and **`reconnect()`** after the inspector drops.
  `connected` reports `isOpen` **liveness**, not allocation — a backgrounded app suspends the
  inspector, leaving a non-null but dead bridge that the next command must re-attach.
- **`execute`/`mock` are synchronous IIFEs** (`commands/execute.ts`). Hermes' `Runtime.evaluate`
  **cannot compile `async`** — Metro/Babel transpiles it away before Hermes, so raw `async` source
  is a compile error; and RN's polyfilled `Promise` internals don't unwrap via CDP `awaitPromise`.
  The user function source is wrapped in a sync IIFE passing the Hermes realm (`globalThis` —
  `nativeModuleProxy`, `HermesInternal`) as the first arg, with extra args inlined as JSON literals
  (`jsonLiteral` escapes `U+2028`/`U+2029`/`<` for the eval sink — CodeQL `js/bad-code-sanitization`,
  a regex guard alone doesn't clear it).
- **Connect lazily.** The worker's `before` does a best-effort warm-up, but the inspector target
  usually isn't registered yet at `before` time, so the real connect happens on first
  `execute`/`mock`/`emitEvent` via an `ensureHermes()` guard. The discovery budget
  (`HERMES_CONNECT_RETRIES`/`HERMES_CONNECT_INTERVAL_MS`, ~60×1s) absorbs Hermes' post-launch
  registration lag and Fabric's later registration (see ci-and-release.md dual-arch note).
- **Mock = Tier 1** (`mock.ts` + `innerRecorder.ts`): the desktop inner/outer doctrine unchanged —
  a `@wdio/native-spy` outer mock in the worker + an inner vitest-shaped spy installed by a
  script-builder under `globalThis.__WDIO_RN_MOCKS__` in the Hermes realm, keyed by dotted target
  path (`nativeModuleProxy.Clipboard.getString`); call history reads back one-way via
  `buildReadCallDataScript` → `update()`. The builders emit **JS expression strings** (unit-tested as
  emitted expressions, not in-realm behaviour); promises/errors cross the boundary via `__wdioType`
  / `__wdioError` markers.

### Dart VM (Flutter) — Tier 2

Flutter runs Dart on its own **VM Service protocol** (not CDP/Hermes), so there is **no JS-eval
channel into the Dart realm** — `execute`/`mock` can't inject transparently. This section carries the
contract shape the Phase-0 spike proved, so you build Flutter **from here** — re-confirm the
specifics in your own spike (versions drift), but you don't need Flutter to exist yet:

- **Connect / `execute`.** Open your own WebSocket to the **Dart VM Service** (the debug/profile
  build the Appium Flutter driver already needs) and call its generic **`evaluate`** RPC — that's the
  eval-equivalent for `execute`. (`appium-flutter-driver` is itself a meta-driver that attaches to the
  VM Service via `ext.flutter.driver` and adds a `FLUTTER` context; open a *parallel* VM-Service
  connection for `execute`/`mock` rather than routing through it.)
- **Mock — the Tier-2 cooperative contract.** Dart has no transparent monkeypatch, so the app
  **opts in**: ship a small **Dart package of service extensions + a mock registry** the app wires its
  DI seams to (opt-in cost ≈ `enableFlutterDriverExtension()`), and the test drives that registry over
  the VM Service (real → mocked → cleared). The **outer mock + one-way `update()` sync reuse
  verbatim** — only the *inner* mock differs (app-registered vs JS-injected). `browser.flutter.mock.*`
  stays API-convergent with the other services. This is a documented **boundary** (you mock
  app-exposed seams), not a missing feature.
- Keep the converged *surface* (`mock`, `clear/reset/restoreAllMocks`, …) — only the inner mechanism
  differs.

(This shape was validated in the RN+Flutter double-spike; that scratch is gitignored, so **this
section is the durable record you build from** — not the spike, and not the Flutter service docs,
which are an *output* written into the Flutter README/`docs/` once it ships.)

### WebView context (Ionic/Capacitor) — Tier 1

A pure-WebView app's scripting realm **is** the webview, reachable through Appium's `WEBVIEW_*`
context (Chrome/Safari devtools). `execute`/`mock` run in that context — same Tier-1 doctrine, the
webview is the realm. Minimal new plumbing beyond context switching.

**Decision rule for the mock tier:** is there an eval channel into the layer you want to mock?
**Yes → Tier 1** (reuse `native-spy` + a script-builder recorder). **No → Tier 2** (cooperative
contract in the app/fixture). See features.md → "Mocking — the two-tier doctrine".

## Contexts (`switchWindow` / `listWindows`)

The converged multi-window surface, reinterpreted: mobile "windows" are **Appium contexts**
(`NATIVE_APP` ↔ `WEBVIEW_*`). `commands/switchContext.ts`: `listWindows` = `getContexts()` normalised
to id strings (Appium 2 returns plain strings *or* `{ id }` objects); `switchWindow` =
`switchContext`. Same API name, mobile semantics.

## Deeplink

`triggerDeeplink` = Appium **`mobile: deepLink`** (the idiomatic cross-platform path since Appium 2;
both drivers implement it), reading `appium:appPackage` (Android) / `appium:bundleId` (iOS). Android
falls back to **`mobile: shell` `am start -a android.intent.action.VIEW`** for drivers without
`mobile: deepLink` (needs Appium relaxed security); iOS has no in-session shell so it rethrows.
Contrast with **desktop** `@wdio/native-core`'s `deeplink.ts` (`rundll32`/`open`/`xdg-open` OS-protocol
spawn) — mobile does **not** use it.

## Logs

Two channels, both gated on `captureBackendLogs` (`logCapture.ts`):
1. **Native device logs** via `browser.getLogs('logcat'|'syslog')`, drained in the worker's
   **`afterTest`** (not `after`) so each test's lines attribute to it — `getLogs` drains everything
   since the last call.
2. **JS console** via CDP `Runtime.consoleAPICalled` over the Hermes bridge. The listener binds to a
   **specific `CdpBridge` instance**, and there is **no dedicated reconnect hook** — so re-attach it
   in the same place you (re)connect: RN attaches once in `before` (the initial warm-up) and
   **re-attaches inside the `ensureHermes()` lazy-(re)connect guard** that the next
   `execute`/`mock`/`emitEvent` triggers (`stopJsLogs?.()` then `startJsLogForwarding(bridge.bridge)`
   on the new instance — `service.ts`). Miss this and the CDP console channel **silently stops
   capturing** after a background-triggered reconnect, with no test failure. (Don't reach for a
   `MetroBridge.on('reconnect', …)` event — RN reconnects lazily via `ensureHermes()`, not a standalone
   `reconnect()`; co-locate the re-attach with that guard.)

## Shared-layer extraction (the Flutter enabler)

The mobile concerns above currently all live inside `packages/react-native-service/src/`. RN is the
**first** mobile consumer; the shared abstraction is only *validated* when the second (Flutter)
needs the same code — so **extract on Flutter's arrival, not before** (the positive case of the
"don't extract speculatively" gotcha — audit each candidate against what Flutter actually needs).

- **Extract-candidates** (RN + Flutter share bit-for-bit): `capabilities.ts` (Appium cap shaping),
  `deviceManager.ts` (the pool), `commands/switchContext.ts` (contexts-as-windows),
  `commands/triggerDeeplink.ts` (`mobile: deepLink` + `am start` fallback), the device-log half of
  `logCapture.ts`, and the `services: ['appium', …]` composition convention.
- **NOT candidates** (the RN Tier-1 *mechanism*, framework-specific): `metroBridge.ts`,
  `hermesBridge.ts`, `hermesTarget.ts`, `innerRecorder.ts`, `mock.ts` — Flutter's Dart-VM Tier-2
  channel shares none of it. (Mirrors the Dioxus precedent: only `shouldLog`/deeplink were genuinely
  shared; `logForwarder`/`logParser` stayed local.)
- **Target: a new `@wdio/native-mobile-core`**, NOT `@wdio/native-core`. `native-core` is desktop
  launcher infra (`PortManager`, `DriverPool`, `DriverProcess`, the OS-protocol `deeplink.ts`) —
  every export assumes a spawned driver/binary the service owns, which has zero overlap with
  Appium-owned-session concerns; folding mobile in would make it a grab-bag and force desktop
  consumers to carry mobile deps. `native-mobile-core` depends on `native-core` for `BaseLauncher`
  (the hook lifecycle mobile reuses) and on `native-cdp-bridge` for the Tier-1 channel.
- **When**: a **dedicated extraction step/PR after RN is green and before Flutter's feature work** — rework RN onto `native-mobile-core` and prove RN's tests still pass, *then* build Flutter on the stable package. Don't interleave the RN refactor with Flutter development (two moving parts). This mirrors the `@wdio/native-cdp-bridge` PR0 precedent; both services being pre-publish means both ship clean on `native-mobile-core` from publish #1.

## Gotcha — the inspector goes quiet when backgrounded (Tier-1/Hermes)

Backgrounding the app suspends the Hermes inspector and its target disappears from `/json/list` —
the WebSocket drops and the bridge goes dead. `MetroBridge.connected` therefore checks `isOpen`
(liveness, not mere allocation) so the next command reconnects. This is the mobile analogue of the
Wry macOS background-throttling gotcha (plumbing-wry.md). Connect **lazily** on first command, not
eagerly in `before` — the eager warm-up races Hermes' registration and would just fail. Under the
New Architecture the inspector also registers *later* than Paper (see the dual-arch note).
