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

> **`execute` / `mock` and the VM Service port — now zero-config.** These connect to the Dart VM
> Service on a fixed port (bound with auth codes disabled, giving a deterministic
> `ws://localhost:<port>/ws`). The launcher **auto-allocates a free `appium:dartVmServicePort` per
> worker**, so you no longer need to set it by hand — pin it yourself only to override. Without it,
> find/tap/deeplink/contexts still work; only `execute`/`mock` use it.
>
> On **iOS** the published `appium-flutter-driver` (≥ 3.7.1) honours the port via `processArguments`.
> On **Android** the equivalent (a `vm-service-port` launch-intent extra + the `flutter:getVMServiceUrl`
> command) lives in a [fork](https://github.com/goosewobbler/appium-flutter-driver) pending an upstream
> PR to `appium/appium-flutter-driver` (the iOS half merged as
> [#870](https://github.com/appium/appium-flutter-driver/pull/870)) — until it lands, Android
> `execute`/`mock` need that fork. The preflight doctor warns if the installed driver lacks
> `getVMServiceUrl`. Set `autoInstallDriver: true` to let the launcher install the `flutter` driver
> for you, and `doctor: { strict: true }` to fail fast on a missing toolchain.

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

  // Setup automation (see "Zero-config setup automation" below)
  autoInstallDriver?: boolean;  // install the flutter Appium driver if missing (default: false)
  doctor?: boolean | { strict?: boolean }; // preflight checks (default: true; { strict: true } aborts on error)

  // Mock lifecycle (run before each test)
  clearMocks?: boolean;         // clear mock call history
  resetMocks?: boolean;         // clear value + call history
  restoreMocks?: boolean;       // remove the mock entirely
}
```

## Zero-config setup automation

Like `@wdio/electron-service` (which auto-manages chromedriver), the service drives as much
of the Appium setup as is feasible. Everything here is **opt-in and apply-if-unset** — an
explicit capability or option you set always wins.

### Auto VM-Service port

The launcher **auto-allocates a free `appium:dartVmServicePort` per worker** (see the note
under [Installation](#installation)), so `execute`/`mock` are zero-config — no manual port,
no log scrape. Pin `vmServicePort` only to override.

### `autoInstallDriver` — install the Appium driver

`autoInstallDriver: true` installs the `flutter` Appium driver (appium-flutter-driver) if
it isn't already present, at a version known-good for your Appium **server major** (from a
maintained matrix). It's **idempotent** and **off by default** (CI usually manages drivers
explicitly). Note it installs the **stock** driver — on Android, `execute`/`mock` still need
the goosewobbler fork until it's upstreamed (see [Installation](#installation)); the doctor
warns when the fork is absent.

### `doctor` — preflight checks

`doctor` runs fail-fast preflight validation in `onPrepare` so a misconfiguration surfaces
as a clear message instead of a cryptic Appium timeout:

| `doctor` | Behaviour |
|---|---|
| `false` | Skip all checks. |
| `true` *(default)*, or omitted | Run the checks; log actionable warnings; never abort. |
| `{ strict: true }` | Run the checks; abort the run (`SevereServiceError`) on any error-level check. |

For Flutter it checks: `@wdio/appium-service` is in `services`, `flutter` is on PATH, the
installed `appium-flutter-driver` carries `getVMServiceUrl` (Android only), and (iOS) the
Xcode toolchain is warm.

### iOS launch caps — auto-applied

On iOS the service fills in launch caps you didn't set (each only if absent): a generous
`appium:wdaLaunchTimeout` / `appium:simulatorStartupTimeout`, `appium:isHeadless` under CI,
and — when you give `appium:deviceName` but no `appium:udid` — it resolves the exact
simulator UDID (preferring the newest runtime) to avoid booting a duplicate-named device.
On Android it sets `appium:autoGrantPermissions`. Set any of these yourself to override.

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

`execute` is **handler-only**: a name with no registered handler throws an error that lists the
registered handlers (so a typo or a forgotten `register()` is obvious) — it does **not** silently
try to evaluate the name as Dart.

> **Planned — arbitrary Dart-expression eval (opt-in).** Evaluating an expression you didn't
> pre-register (e.g. `execute('1 + 1')`) needs an attached Dart compiler, since Dart has no built-in
> runtime eval. That's a planned opt-in
> ([#389](https://github.com/webdriverio/desktop-mobile/issues/389)) — when enabled it attaches a
> compiler (`flutter attach`) for local/ad-hoc use (Flutter SDK + project required; not for CI or
> parallel runs).

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
