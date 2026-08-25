# @wdio/react-native-service

WebdriverIO service for end-to-end testing [React Native](https://reactnative.dev)
mobile applications on **Android and iOS**.

React Native is a hybrid automation target. Native find/tap runs over an Appium W3C
session (UiAutomator2 on Android, XCUITest on iOS). `execute` and `mock` run in the
app's own **Hermes** JavaScript realm over the Chrome DevTools Protocol, attached
through **Metro's inspector-proxy** — structurally identical to how
`@wdio/electron-service` drives Electron, and reusing the same
[`@wdio/native-cdp-bridge`](../native-cdp-bridge).

> **Status: `1.0.0-next.x` pre-release.** Both platforms ship together; the feature
> surface is complete. `execute` and `mock` require a **debug / Metro build**
> (Hermes inspector is only active with `HERMES_ENABLE_DEBUGGER` / Fusebox). See
> [Known limitations](#known-limitations).

## Installation

```sh
npm install --save-dev @wdio/react-native-service
```

The service **composes with `@wdio/appium-service`** — install that too:

```sh
npm install --save-dev @wdio/appium-service
```

## Quick start

```ts
// wdio.conf.ts
import type { ReactNativeCapabilities, ReactNativeServiceOptions } from '@wdio/native-types';

const rnOptions: ReactNativeServiceOptions = {
  captureBackendLogs: true,
  captureFrontendLogs: true,
};

export const config = {
  services: [
    'appium',                          // starts the local Appium server
    ['react-native', { ...rnOptions }],
  ],
  capabilities: [
    {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:deviceName': 'emulator-5554',
      'appium:app': '/path/to/app-debug.apk',
      'wdio:reactNativeServiceOptions': rnOptions,
    } satisfies ReactNativeCapabilities,
  ],
  // ... mocha/spec config
};
```

```ts
// a spec
it('should run code in the Hermes realm', async () => {
  const inHermes = await browser.reactNative.execute((rn) => typeof rn.HermesInternal !== 'undefined');
  expect(inHermes).toBe(true);
});

it('should mock a module function', async () => {
  const greet = await browser.reactNative.mock('globalThis.MyModule.greet');
  await greet.mockReturnValue('Hello, mock!');
  const result = await browser.reactNative.execute(() => globalThis.MyModule.greet('world'));
  expect(result).toBe('Hello, mock!');
  await browser.reactNative.restoreAllMocks();
});
```

## Build requirement

The app must be a **debug / Metro build** for `execute` and `mock` to work. React
Native ships the Hermes inspector only when `HERMES_ENABLE_DEBUGGER` is set — the
default for `Debug` / `DebugOptimized` variants, and selectively for `Release` via
Fusebox flags.

For **Android**: `cd android && ./gradlew assembleDebug`

For **iOS**: `cd ios && xcodebuild -workspace App.xcworkspace -scheme App -configuration Debug -sdk iphonesimulator`

Native find/tap via Appium works with any build (debug or release).

`execute` / `mock` also need **Metro running** so Hermes exposes its inspector target. Start
it yourself (`npx react-native start`), or set **`manageMetro: true`** to have the service
start it, wait for readiness, and tear it down on completion (optionally `prebundle: true`
to warm the first cold compile). The preflight doctor warns if Metro is unreachable.

## Capabilities

All standard [Appium capabilities](https://appium.io/docs/en/latest/guides/caps/) are
supported. The service adds `wdio:reactNativeServiceOptions`:

| Capability | Type | Description |
|---|---|---|
| `platformName` | `'Android' \| 'iOS'` | Target platform (required) |
| `appium:automationName` | `'UiAutomator2' \| 'XCUITest'` | Automation driver (defaults to platform) |
| `appium:deviceName` | `string` | Device name or emulator AVD name |
| `appium:udid` | `string` | Device serial (Android) or UDID (iOS) |
| `appium:app` | `string` | Path to the built APK / .app bundle |
| `appium:noReset` | `boolean` | Skip app reset between sessions |
| `wdio:reactNativeServiceOptions` | `ReactNativeServiceOptions` | Service options |

## Service options (`ReactNativeServiceOptions`)

```ts
interface ReactNativeServiceOptions {
  // Metro inspector-proxy connection
  metroHost?: string;           // default: 'localhost'
  metroPort?: number;           // default: 8081

  // Metro lifecycle (opt-in) — the service owns `react-native start` so you don't have to
  manageMetro?: boolean;        // start/stop Metro for the run (default: false)
  metroProjectRoot?: string;    // app project root for `react-native start` (default: cwd)
  prebundle?: boolean;          // warm the cold compile via /index.bundle (default: false)

  // Appium driver auto-install + preflight doctor (shared mobile setup automation)
  autoInstallDriver?: boolean;  // install uiautomator2 / xcuitest if missing (default: false)
  doctor?: boolean | { strict?: boolean }; // preflight checks (default: true; { strict: true } aborts on error)

  // Convenience — maps onto appium:app if not already set in the capability
  appBinaryPath?: string;

  // Device pool for parallel workers / multiremote
  devices?: Array<{ udid?: string; avd?: string; iOSUdid?: string }>;

  // Log capture
  captureBackendLogs?: boolean;
  captureFrontendLogs?: boolean;
  backendLogLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  frontendLogLevel?: 'trace' | 'debug' | 'info' | 'warn' | 'error';

  // Mock lifecycle
  clearMocks?: boolean;         // clear mock call history before each test
  resetMocks?: boolean;         // reset mock implementations before each test
  restoreMocks?: boolean;       // restore originals before each test
}
```

## Zero-config setup automation

Like `@wdio/electron-service` (which auto-manages chromedriver), the service can drive as
much of the Appium setup as is feasible. Everything here is **opt-in and apply-if-unset** —
an explicit capability or option you set always wins.

### `manageMetro` — own the Metro lifecycle

Covered under [Build requirement](#build-requirement): `manageMetro: true` starts
`react-native start` for the run, waits for readiness, optionally pre-bundles, and tears it
down on completion — so you don't script it yourself.

### `autoInstallDriver` — install the Appium driver

`autoInstallDriver: true` installs the platform's Appium driver (`uiautomator2` on Android,
`xcuitest` on iOS) if it isn't already present, at a version known-good for your Appium
**server major** (from a maintained matrix). It's **idempotent** — a no-op when the driver
is already installed — and **off by default**, because CI usually manages drivers explicitly
and may lack network/permissions. Requires `appium` to be resolvable (it comes with
`@wdio/appium-service`).

### `doctor` — preflight checks

`doctor` runs fail-fast preflight validation in `onPrepare` so a misconfiguration surfaces
as a clear message instead of a cryptic Appium timeout:

| `doctor` | Behaviour |
|---|---|
| `false` | Skip all checks. |
| `true` *(default)*, or omitted | Run the checks; log actionable warnings; never abort. |
| `{ strict: true }` | Run the checks; abort the run (`SevereServiceError`) on any error-level check. |

For React Native it checks: `@wdio/appium-service` is in `services`, Metro is reachable on
the configured port, and (iOS) the Xcode toolchain is warm. Checks are advisory (`warn`)
unless you opt into `'strict'`.

### iOS launch caps — auto-applied

On iOS the service fills in launch caps you didn't set (each only if absent): a generous
`appium:wdaLaunchTimeout` / `appium:simulatorStartupTimeout`, `appium:isHeadless` under CI,
and — when you give `appium:deviceName` but no `appium:udid` — it resolves the exact
simulator UDID (preferring the newest runtime) to avoid booting a duplicate-named device.
On Android it sets `appium:autoGrantPermissions`. Set any of these yourself to override.

## API (`browser.reactNative.*`)

### `execute(fn, ...args)`

Run a function in the app's Hermes JS realm. Works exactly like `browser.execute`
but evaluates inside the RN app instead of a browser page.

```ts
const counter = await browser.reactNative.execute(() => globalThis.__appState__.counter);
```

> **Requires a debug / Metro build.** An explicit error is thrown if no live Hermes
> target is found on Metro's inspector-proxy.

### `mock(path)`

Create a mock for a function reachable via a dotted path in the Hermes global.
Returns a mock instance compatible with the Vitest/Jest mock API.

```ts
const fn = await browser.reactNative.mock('globalThis.Analytics.track');
await fn.mockReturnValue(undefined);

// ... run the test ...

expect(fn.mock.calls).toHaveLength(1);
await browser.reactNative.restoreAllMocks();
```

> **JS-module scope only.** Only functions reachable from the Hermes `globalThis`
> can be mocked. Native modules (implemented in Java/Kotlin or Objective-C/Swift) are
> not patchable this way.

### `mockAll(path)`

Mock **every function-valued property** of the object at a dotted path in one call, and
get back a `{ name: mock }` map. Handy for stubbing a whole module namespace.

```ts
const clip = await browser.reactNative.mockAll('globalThis.Clipboard');
await clip.getString.mockResolvedValue('mocked');
await clip.setString.mockReturnValue(undefined);
// ... later
await browser.reactNative.restoreAllMocks();
```

Returns an empty map if the path doesn't resolve or holds no functions.

### `clearAllMocks()` / `resetAllMocks()` / `restoreAllMocks()`

Lifecycle helpers — equivalent to `vi.clearAllMocks()` etc., but operating on the
RN service's mock registry.

### `isMockFunction(fnOrPath)`

Pass a value to check if it's an active RN mock instance (TypeScript narrows it to a mock),
or pass a target-path string to check if that path is currently mocked.

### `triggerDeeplink(url)`

Open a deep link in the running app via Appium's `mobile: deepLink` command.

```ts
await browser.reactNative.triggerDeeplink('myapp://products/42');
```

### `switchContext(name)` / `listContexts()`

Switch between Appium contexts — `NATIVE_APP`, `WEBVIEW_*`, or (via the Appium
Flutter meta-driver) `FLUTTER`. These are the mobile counterpart of the desktop
services' `switchWindow`/`listWindows`: mobile switches Appium **contexts**, named
idiomatically rather than as "windows".

```ts
const contexts = await browser.reactNative.listContexts();
await browser.reactNative.switchContext(contexts.find(c => c.startsWith('WEBVIEW')) ?? 'NATIVE_APP');
```

### `emitEvent(name, payload?)`

Emit a React Native `DeviceEventEmitter` event, triggering any registered listeners
in the app without UI interaction.

```ts
await browser.reactNative.emitEvent('onNetworkChange', { isConnected: false });
```

## Element finding

React Native renders **real native views**, so standard Appium locators apply:

| RN prop | Appium strategy | Example |
|---|---|---|
| `testID` | `accessibility id` (iOS) or `id` / `resource-id` (Android) | `browser.$('~my-button')` |
| `accessibilityLabel` | `accessibility id` | `browser.$('~Submit')` |
| `text` (Android) | `-android uiautomator` | `browser.$('android=new UiSelector().text("Submit")')` |
| class / xpath | `xpath` | `browser.$('//android.widget.Button')` |

> **iOS locator note:** a static `accessibilityLabel` on a value-bearing element
> masks the element's runtime value on iOS. Read dynamic text from the `value`
> attribute (iOS) or element `text` (Android), not the label.

## Context switching (hybrid apps)

RN apps that embed a WebView expose a `WEBVIEW_*` context alongside `NATIVE_APP`.
Use `listContexts`/`switchContext` (or the raw Appium `context` command) to drive
the WebView as a browser:

```ts
await browser.reactNative.switchContext('WEBVIEW_com.myapp');
const title = await browser.getTitle();
await browser.reactNative.switchContext('NATIVE_APP');
```

## Log capture

The service forwards two independent channels into the WDIO test output, each opt-in
and off by default:

- **Backend** — native device logs: **logcat** (Android) / **syslog** (iOS). Enable with
  `captureBackendLogs`; filter with `backendLogLevel` (default `info`).
- **Frontend** — the app's JS / Metro console (`console.log/info/warn/error`, via the
  Hermes `Runtime.consoleAPICalled` CDP event). Enable with `captureFrontendLogs`; filter
  with `frontendLogLevel` (default `info`). Requires a debug / Metro build (same Hermes
  inspector `execute`/`mock` use).

`*LogLevel` is the minimum level captured — e.g. `frontendLogLevel: 'warn'` drops
`console.log`/`console.info`. (`console.log` is treated as `info`.)

## Parallel workers

Set `devices` in the service options to pool descriptors across workers:

```ts
const config = {
  maxInstances: 2,
  services: [
    'appium',
    ['react-native', {
      devices: [
        { avd: 'Pixel_8_API_35' },
        { avd: 'Pixel_7_API_35' },
      ],
    }],
  ],
  // ...
};
```

Each worker claims a device round-robin. Omit `devices` for a single-device run —
Appium picks whatever is connected.

> **Multiremote** — one session driving several devices at once (a capabilities object plus
> `multiremotebrowser.getInstance(...)`) — is **not yet supported**: the `devices` pool gives each
> *worker* one device, not each *instance*. Tracked in
> [webdriverio/desktop-mobile#446](https://github.com/webdriverio/desktop-mobile/issues/446).

## Standalone / session mode

Use `startWdioSession` to drive sessions outside of the WDIO runner. It takes a
`ReactNativeCapabilities` object and resolves to the `browser`; pass the same
browser to `cleanupWdioSession` to tear the session down. Appium must already be
running (the standalone path does not spawn it).

```ts
import { startWdioSession, cleanupWdioSession } from '@wdio/react-native-service';

const browser = await startWdioSession({
  platformName: 'Android',
  'appium:automationName': 'UiAutomator2',
  'appium:app': '/path/to/app-debug.apk',
});
try {
  const result = await browser.reactNative.execute(() => 'hello');
  console.log(result);
} finally {
  await cleanupWdioSession(browser);
}
```

## Known limitations

| Area | Status |
|---|---|
| `execute` / `mock` | ✅ supported — **debug / Metro build only** (Hermes inspector present only when `HERMES_ENABLE_DEBUGGER` is set) |
| Android | ✅ full support |
| iOS | ✅ full support |
| parallel workers | ✅ N workers → N devices via the `devices` pool |
| multiremote (one session, N devices) | ❌ not yet — [#446](https://github.com/webdriverio/desktop-mobile/issues/446) |
| context switching (`NATIVE_APP` ↔ `WEBVIEW_*`) | ✅ |
| deeplink | ✅ via `mobile: deepLink` |
| log capture | ✅ logcat / syslog + Metro console |
| `emitEvent` | ✅ via `DeviceEventEmitter` |
| mock — JS-global scope only | ⚠️ native-module internals (Java/Kotlin, Obj-C/Swift) not patchable from JS |
| Release build `execute` / `mock` | ❌ Hermes inspector not present in stock release builds |

## License

MIT
