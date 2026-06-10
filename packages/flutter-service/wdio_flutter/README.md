# wdio_flutter

The app-side contract for [`@wdio/flutter-service`](https://www.npmjs.com/package/@wdio/flutter-service)
— the Dart half of `browser.flutter.mock.*`.

Dart has no runtime monkeypatch, so mocking is **cooperative**: your app routes its DI seams
through `wdioRegistry` and calls `enableWdioMocking()` once at startup. The WebdriverIO Flutter
service then drives the registry over the Dart VM Service via `ext.wdio.*` service extensions —
your test controls mocked values and reads call data through the converged `browser.flutter.mock.*`
surface.

This is pure Dart (`dart:developer` only) — no Flutter dependency — so it works in any Flutter app.

## Setup

Add the dependency:

```yaml
dependencies:
  wdio_flutter: ^1.0.0
```

Enable it in `main()` — **after** `enableFlutterDriverExtension()` (which initializes the binding)
and **before** `runApp()`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_driver/driver_extension.dart';
import 'package:wdio_flutter/wdio_flutter.dart';

void main() {
  enableFlutterDriverExtension();
  enableWdioMocking();
  runApp(const MyApp());
}
```

## Wiring a seam

Route the method you want to be mockable through the registry:

```dart
class GreetingService {
  Future<String> greet(String name) =>
      wdioRegistry.interceptAsync('GreetingService.greet', [name], () async => 'hello $name');
}
```

Now the test can mock it:

```js
const greet = await browser.flutter.mock('GreetingService.greet');
await greet.mockReturnValue('mocked');
// … exercise the app …
await greet.update();
expect(greet.mock.calls).toHaveLength(1);
```

This is a documented **boundary**: you mock the seams the app exposes (idiomatic Flutter DI), not
arbitrary internals — Dart can't replace a function in place at runtime.

> **Serialization note.** Call args and recorded return values are sent test-side as JSON. A
> non-JSON-serializable Dart object (a custom class instance) is encoded as its `toString()` rather
> than throwing — the call is still recorded, but assert against serializable values
> (`String`/`num`/`bool`/`List`/`Map`) for deep equality.
