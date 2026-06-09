# @wdio/react-native-service

WebdriverIO service for end-to-end testing [React Native](https://reactnative.dev)
mobile applications on **Android and iOS**.

React Native is a hybrid automation target. Native find/tap runs over an Appium W3C
session (UiAutomator2 on Android, XCUITest on iOS). `execute` and `mock` run in the
app's own **Hermes** JavaScript realm over the Chrome DevTools Protocol, attached
through **Metro's inspector-proxy** — structurally identical to how
`@wdio/electron-service` drives Electron, and reusing the same
[`@wdio/native-cdp-bridge`](../native-cdp-bridge).

> **Status: `1.0.0-next` pre-release.** Both platforms ship together; the feature
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
  const inHermes = await browser.reactNative.execute(() => typeof HermesInternal !== 'undefined');
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

### `clearAllMocks()` / `resetAllMocks()` / `restoreAllMocks()`

Lifecycle helpers — equivalent to `vi.clearAllMocks()` etc., but operating on the
RN service's mock registry.

### `isMockFunction(fn)`

Returns `true` if the argument is an active RN mock instance.

### `triggerDeeplink(url)`

Open a deep link in the running app via Appium's `mobile: deepLink` command.

```ts
await browser.reactNative.triggerDeeplink('myapp://products/42');
```

### `switchContext(name)` / `listContexts()`

Switch between Appium contexts — `NATIVE_APP`, `WEBVIEW_*`, or (via the Appium
Flutter meta-driver) `FLUTTER`.

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

The service collects **logcat** (Android) / **syslog** (iOS) and **Metro console**
logs and forwards them to the WDIO test output. Enable via `captureBackendLogs` and
`captureFrontendLogs` in the service options.

## Multiremote / parallel workers

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

## Standalone / session mode

Use `createReactNativeCapabilities` and `startWdioSession` to drive sessions outside
of the WDIO runner:

```ts
import { createReactNativeCapabilities, startWdioSession } from '@wdio/react-native-service';

const { browser, cleanup } = await startWdioSession({
  platformName: 'Android',
  appPath: '/path/to/app-debug.apk',
});
try {
  const result = await browser.reactNative.execute(() => 'hello');
  console.log(result);
} finally {
  await cleanup();
}
```

## Known limitations

| Area | Status |
|---|---|
| `execute` / `mock` | ✅ supported — **debug / Metro build only** (Hermes inspector present only when `HERMES_ENABLE_DEBUGGER` is set) |
| Android | ✅ full support |
| iOS | ✅ full support |
| multiremote | ✅ via the `devices` pool |
| context switching (`NATIVE_APP` ↔ `WEBVIEW_*`) | ✅ |
| deeplink | ✅ via `mobile: deepLink` |
| log capture | ✅ logcat / syslog + Metro console |
| `emitEvent` | ✅ via `DeviceEventEmitter` |
| mock — JS-global scope only | ⚠️ native-module internals (Java/Kotlin, Obj-C/Swift) not patchable from JS |
| Release build `execute` / `mock` | ❌ Hermes inspector not present in stock release builds |

## License

MIT
