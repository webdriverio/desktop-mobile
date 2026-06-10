# Flutter E2E fixture

The app `@wdio/flutter-service`'s e2e suite drives (PR4 Android / PR5 iOS).

**Source-only.** Only `lib/main.dart` + `pubspec.yaml` are committed; the platform projects
(`android/`, `ios/`, …) and build outputs are generated in CI with `flutter create .` over this
directory, then `flutter build apk --debug` / `flutter build ios --debug` (debug builds expose the
Dart VM Service that `browser.flutter.execute`/`mock` attach to). This mirrors the React Native
fixture's scaffold-in-CI approach.

`lib/main.dart` wires the `wdio_flutter` contract (`enableFlutterDriverExtension()` →
`enableWdioMocking()` → `runApp()`) and exposes the convergent surface the specs exercise:

| Feature | Hook in the app |
|---|---|
| find/tap | `ValueKey('increment')` button, `ValueKey('counter')` text |
| mock | `GreetingService.greet` routed through `wdioRegistry` (Tier-2 seam) → `ValueKey('greeting')` |
| execute | top-level `fixtureMarker` constant |
| emitEvent | `wdioEvents.stream` listener → `ValueKey('lastEvent')` |
