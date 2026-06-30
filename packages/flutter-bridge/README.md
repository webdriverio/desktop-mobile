# wdio_flutter

The app-side contract for [`@wdio/flutter-service`](https://www.npmjs.com/package/@wdio/flutter-service)
— the Dart half of `browser.flutter.mock.*` and `browser.flutter.execute`.

Dart is ahead-of-time compiled with no runtime monkeypatch, so both are **cooperative**: your app
routes its DI seams through `wdioRegistry` (for mocking) and registers named handlers on
`wdioHandlers` (for `execute`), then calls `enableWdioMocking()` once at startup. The WebdriverIO
Flutter service drives these over the Dart VM Service via `ext.wdio.*` service extensions — your
test controls mocked values, reads call data, and invokes handlers through the converged
`browser.flutter.*` surface.

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

## Registering execute handlers

`browser.flutter.execute` follows the same cooperative model. Dart is ahead-of-time compiled, so
there's no runtime source eval — instead your app registers named handlers, and the test invokes
them by name. Register them alongside `enableWdioMocking()`:

```dart
void main() {
  enableFlutterDriverExtension();
  enableWdioMocking();
  wdioHandlers.register('readCounter', () => counter);   // sync
  wdioHandlers.register('add', (int a, int b) => a + b);  // positional args
  wdioHandlers.register('loadUser', (String id) async => fetchUser(id)); // async (Future)
  runApp(const MyApp());
}
```

```js
// test — args are JSON-serialised, the result is returned as-is
await browser.flutter.execute('readCounter');     // → 0
await browser.flutter.execute('add', 2, 3);       // → 5
await browser.flutter.execute('loadUser', 'u1');  // awaits the Future
```

`execute` is **handler-only**: an unknown name throws an error listing the registered handlers (it
does not silently evaluate the name as Dart).

> **Planned — arbitrary Dart-expression eval (opt-in).** Evaluating an unregistered expression
> (e.g. `execute('1 + 1')`) needs an attached Dart compiler — a planned opt-in
> ([#389](https://github.com/webdriverio/desktop-mobile/issues/389)). Until then, register a handler
> for anything you want to drive.
