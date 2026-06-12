# @wdio/flutter-service

WebdriverIO service for end-to-end testing [Flutter](https://flutter.dev) applications on
**Android and iOS**.

Flutter is a **self-rendered** automation target — it paints its own widgets to a canvas
rather than composing native views. Native find/tap therefore runs over
[appium-flutter-driver](https://github.com/appium/appium-flutter-driver) (automationName
`Flutter`, the `FLUTTER` context), while `execute` and `mock` run in the app's **Dart isolate**
over the [Dart VM Service](https://github.com/dart-lang/sdk/blob/main/runtime/vm/service/service.md)
— the service opens its own JSON-RPC-over-WebSocket connection to the observatory.

Mocking is **cooperative** (Dart has no runtime monkey-patch): the app opts in via the
[`wdio_flutter`](./wdio_flutter) Dart package, routing its DI seams through a registry the service
drives over `ext.wdio.*` service extensions.

> **Status: `1.0.0-next.x` pre-release.** Both platforms ship together; the feature surface is
> complete. `execute` and `mock` require a **debug / profile build** (the VM Service is not
> exposed in release builds). See [Known limitations](#known-limitations).

## Installation

```sh
npm install --save-dev @wdio/flutter-service
```

The service **composes with `@wdio/appium-service`** — install that too:

```sh
npm install --save-dev @wdio/appium-service
```

Native find/tap needs the Appium Flutter driver:

```sh
appium driver install --source=npm appium-flutter-driver
```

> **`execute` / `mock` prerequisite — pin the VM Service port.** These connect to the Dart VM
> Service, which the driver discovers by scraping the device log — a path that isn't exposed to
> the service. Instead, **set `appium:dartVmServicePort`** (a fixed port) so the driver binds the VM
> Service to it with auth codes disabled, giving a deterministic `ws://localhost:<port>/ws` the
> service connects to directly.
>
> On **iOS** the published `appium-flutter-driver` (≥ 3.7.1) already pins the port via
> `processArguments`. On **Android** the equivalent (a `vm-service-port` launch-intent extra) lives
> in a [fork](https://github.com/goosewobbler/appium-flutter-driver) pending an upstream PR — until
> it lands, Android `execute`/`mock` need that fork (to be published as
> `@goosewobbler/appium-flutter-driver`: `appium driver install --source=npm @goosewobbler/appium-flutter-driver`).
> Without the pin, find/tap/deeplink/contexts still work — only `execute`/`mock` need it.

## Quick start

```ts
// wdio.conf.ts
import type { FlutterCapabilities, FlutterServiceOptions } from '@wdio/native-types';

const flutterOptions: FlutterServiceOptions = {
  captureBackendLogs: true,
};

export const config = {
  services: [
    'appium',                       // starts the local Appium server
    ['flutter', { ...flutterOptions }],
  ],
  capabilities: [
    {
      platformName: 'Android',
      'appium:automationName': 'Flutter',
      'appium:deviceName': 'emulator-5554',
      'appium:app': '/path/to/app-debug.apk',
      'wdio:flutterServiceOptions': flutterOptions,
    } satisfies FlutterCapabilities,
  ],
  // ... mocha/spec config
};
```

```ts
// a spec — execute invokes a handler the app registered (e.g. wdioHandlers.register('add', ...))
it('should invoke a Dart handler', async () => {
  const sum = await browser.flutter.execute<number>('add', 2, 3);
  expect(sum).toBe(5);
});

it('should tap a widget by ValueKey and read text', async () => {
  await browser.flutter.byValueKey('increment').tap();
  expect(await browser.flutter.byValueKey('counter').getText()).toBe('1');
});

it('should mock an app-exposed seam', async () => {
  const greet = await browser.flutter.mock('GreetingService.greet');
  await greet.mockReturnValue('Hello, mock!');
  // ... exercise the app ...
  await greet.update();
  expect(greet.mock.calls).toHaveLength(1);
  await browser.flutter.restoreAllMocks();
});
```

## Build requirement

`execute` and `mock` attach to the **Dart VM Service**, which is exposed only by a **debug or
profile build** — not a release build. The app must initialise the driver extension (and, for
mocking, the `wdio_flutter` contract) at startup, **before** `runApp()`:

```dart
import 'package:flutter_driver/driver_extension.dart';
import 'package:wdio_flutter/wdio_flutter.dart';

void main() {
  enableFlutterDriverExtension(); // initialises the binding + the Flutter driver channel
  enableWdioMocking();            // registers ext.wdio.* (call AFTER, before runApp)
  runApp(const MyApp());
}
```

Build a debug app:

- **Android**: `flutter build apk --debug`
- **iOS** (simulator): `flutter build ios --debug --simulator`

Native find/tap via appium-flutter-driver works with any debug/profile build.

## Capabilities

All standard [Appium capabilities](https://appium.io/docs/en/latest/guides/caps/) are supported.
The service adds `wdio:flutterServiceOptions`:

| Capability | Type | Description |
|---|---|---|
| `platformName` | `'Android' \| 'iOS'` | Target platform (required) |
| `appium:automationName` | `'Flutter'` | appium-flutter-driver, both platforms |
| `appium:deviceName` | `string` | Device name or emulator AVD name |
| `appium:udid` | `string` | Device serial (Android) or UDID (iOS) |
| `appium:app` | `string` | Path to the built `.apk` / `.app` |
| `appium:dartVmServicePort` | `number` | Pin the VM Service port → skips the (up to 60s) log scrape (CI-robust) |
| `wdio:flutterServiceOptions` | `FlutterServiceOptions` | Service options |

## Service options (`FlutterServiceOptions`)

```ts
interface FlutterServiceOptions {
  // Dart VM Service connection
  vmServiceHost?: string;       // default: 'localhost'
  vmServicePort?: number;       // pin the port (skips the log scrape); also via appium:dartVmServicePort

  // Convenience — maps onto appium:app if not already set in the capability
  appBinaryPath?: string;

  // Device pool for parallel workers / multiremote
  devices?: Array<{ udid?: string; avd?: string; iOSUdid?: string }>;

  // Log capture
  captureBackendLogs?: boolean; // forward logcat (Android) / syslog (iOS) to the WDIO output

  // Mock lifecycle (run before each test)
  clearMocks?: boolean;         // clear mock call history
  resetMocks?: boolean;         // clear value + call history
  restoreMocks?: boolean;       // remove the mock entirely
}
```

## API (`browser.flutter.*`)

### `execute(name, ...args)`

Invoke a Dart **handler your app registered** with `wdio_flutter`, by name, with positional args.

> **Two modes — handlers (default) + raw eval (opt-in).** Flutter is ahead-of-time compiled, so —
> unlike the JS-runtime services — there's no built-in way to run an arbitrary code string in the
> app. Instead `execute` is cooperative (the same model as [`mock`](#mocktarget)): you expose the
> operations you want to drive as named handlers, then call them by name. This works everywhere —
> CI, parallel sessions, no extra tooling.

```dart
// app — register handlers up front, alongside enableWdioMocking()
wdioHandlers.register('readCounter', () => counter);
wdioHandlers.register('add', (int a, int b) => a + b);
```

```ts
// test
const count = await browser.flutter.execute<number>('readCounter');
const sum = await browser.flutter.execute<number>('add', 2, 3); // → 5
```

> **Advanced — evaluating arbitrary Dart expressions (opt-in).** To evaluate an expression you
> didn't pre-register (handy when debugging), attach a Dart compiler: run
> `flutter attach --debug-url <vm-service-url>` against the running app, and a name that isn't a
> registered handler is evaluated as Dart source — e.g. `execute('1 + 1')` → `2`. This needs the
> Flutter SDK and your project where the tests run, so it's for local/ad-hoc use, not CI or parallel
> runs. Without it, `execute` resolves registered handlers only (and says so if a name isn't found).

### `mock(target)`

Mock a Dart seam the app exposed through the `wdio_flutter` contract, addressed by its target id.
Returns a Vitest/Jest-compatible mock instance.

```ts
const fn = await browser.flutter.mock('Analytics.track');
await fn.mockReturnValue(null);
// ... run the test ...
await fn.update();            // sync call data from the app into fn.mock.calls
expect(fn.mock.calls).toHaveLength(1);
await browser.flutter.restoreAllMocks();
```

> **Cooperative-seam scope.** You mock the seams the app routes through `wdioRegistry`
> (idiomatic Flutter DI), not arbitrary internals. There is no `mockImplementation` — Dart can't
> serialise a JS closure across the boundary; use `mockReturnValue` / `mockResolvedValue` /
> `mockRejectedValue` with serialisable values. See the [`wdio_flutter` contract](./wdio_flutter).

> **Recorded values are JSON.** `mock.mock.calls` / `mock.mock.results` are synced from the app
> over `ext.wdio.getCalls` as JSON. A seam arg or **real** (un-mocked) return value that isn't
> JSON-serialisable — a custom Dart class instance — arrives on the test side as its `toString()`
> string, not a structured object. Assert against serialisable values (`String`/`num`/`bool`/
> `List`/`Map`) for deep equality.

### `clearAllMocks()` / `resetAllMocks()` / `restoreAllMocks()`

Lifecycle helpers — `vi.clearAllMocks()`-equivalents over the Flutter mock registry. Also wired to
the `clearMocks` / `resetMocks` / `restoreMocks` service options (run before each test).

### `isMockFunction(targetOrFn)`

Returns `true` if the argument is an active Flutter mock (or a mocked target path).

### `triggerDeeplink(url)`

Open a deep link in the running app via Appium's `mobile: deepLink` (switches to `NATIVE_APP`
first).

```ts
await browser.flutter.triggerDeeplink('myapp://products/42');
```

### `switchContext(context)` / `listContexts()`

Switch between Appium contexts — `NATIVE_APP` ↔ `FLUTTER` (↔ `WEBVIEW_*` for embedded web).

### `emitEvent(name, payload?)`

Emit an event into the app's `wdio_flutter` event bus. The app opts in by listening to
`wdioEvents.stream` (e.g. to drive navigation or a feature flag from a test).

```ts
await browser.flutter.emitEvent('deeplink', { path: '/profile' });
```

## Element finding

Flutter paints its own widgets, so prefer the Flutter finders (they run in the `FLUTTER` context,
auto-switched):

```ts
await browser.flutter.byValueKey('increment').tap();           // const ValueKey('increment')
const text = await browser.flutter.byText('Submit').getText();
```

Raw [appium-flutter-driver finders](https://github.com/appium/appium-flutter-driver#finders) remain
available via `browser.$(<json-finder>)` once in the `FLUTTER` context.

## Log capture

The service collects **logcat** (Android) / **syslog** (iOS) and forwards them to the WDIO test
output. Enable via `captureBackendLogs`.

## Multiremote / parallel workers

Set `devices` in the service options to pool descriptors across workers:

```ts
const config = {
  maxInstances: 2,
  services: [
    'appium',
    ['flutter', {
      devices: [{ avd: 'Pixel_8_API_35' }, { avd: 'Pixel_7_API_35' }],
    }],
  ],
};
```

Each worker claims a device round-robin (and its own `adb forward` tunnel). Omit `devices` for a
single-device run.

## Standalone / session mode

Use `startWdioSession` to drive sessions outside the WDIO runner:

```ts
import { startWdioSession, cleanupWdioSession } from '@wdio/flutter-service';

const browser = await startWdioSession({
  platformName: 'Android',
  'appium:automationName': 'Flutter',
  'appium:app': '/path/to/app-debug.apk',
});
try {
  console.log(await browser.flutter.execute('readCounter'));
} finally {
  await cleanupWdioSession(browser);
}
```

## Known limitations

| Area | Status |
|---|---|
| `execute` (Dart expression) | ✅ supported — **debug / profile build only** (VM Service) |
| `mock` (cooperative contract) | ✅ supported — app opts in via [`wdio_flutter`](./wdio_flutter) |
| Android | ✅ full support |
| iOS | ✅ full support |
| find/tap (`byValueKey` / `byText`) | ✅ via appium-flutter-driver |
| multiremote | ✅ via the `devices` pool |
| context switching (`NATIVE_APP` ↔ `FLUTTER`) | ✅ |
| deeplink | ✅ via `mobile: deepLink` |
| log capture | ✅ logcat / syslog |
| `emitEvent` | ✅ via the `wdio_flutter` event bus |
| `mockImplementation` | ❌ Dart can't run a serialised JS closure — use `mockReturnValue` etc. |
| Release build `execute` / `mock` | ❌ the VM Service is not exposed in release builds |

## License

MIT
