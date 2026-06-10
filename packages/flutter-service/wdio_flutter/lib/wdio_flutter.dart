/// WebdriverIO Flutter service contract.
///
/// The app-side half of `browser.flutter.mock.*`. Dart has no runtime monkeypatch, so
/// mocking is cooperative: the app routes its DI seams through [wdioRegistry] and calls
/// [enableWdioMocking] once at startup. `@wdio/flutter-service` then drives the registry
/// over the Dart VM Service via the `ext.wdio.*` service extensions.
///
/// ```dart
/// void main() {
///   enableFlutterDriverExtension(); // initializes the binding
///   enableWdioMocking();            // register ext.wdio.* (call AFTER, before runApp)
///   runApp(const MyApp());
/// }
///
/// class GreetingService {
///   Future<String> greet(String name) =>
///       wdioRegistry.interceptAsync('GreetingService.greet', [name], () async => 'hello $name');
/// }
/// ```
library;

import 'dart:convert';
import 'dart:developer' as developer;

int _invocationCounter = 0;

/// Cast a JSON-decoded mock value to the seam's return type `T`, coercing between Dart
/// numeric types first: `jsonDecode` yields `int` for whole numbers, so a `double`-typed
/// seam would otherwise hit `int as double` — which throws in Dart. Other types fall
/// through to a plain cast.
T _castMockValue<T>(dynamic value) {
  if (value is num) {
    if (T == double) return value.toDouble() as T;
    if (T == int) return value.toInt() as T;
  }
  return value as T;
}

class _MockEntry {
  /// Default mocked value (`{kind, value}`), or null when not mocked.
  Map<String, dynamic>? value;

  /// Queued one-shot values (FIFO), consumed before the default.
  final List<Map<String, dynamic>> onceQueue = [];

  final List<List<dynamic>> calls = [];
  final List<Map<String, dynamic>> results = [];
  final List<int> invocationCallOrder = [];

  /// Take the active mock spec for the next call (a queued once-value wins), or null.
  Map<String, dynamic>? takeValue() {
    if (onceQueue.isNotEmpty) {
      return onceQueue.removeAt(0);
    }
    return value;
  }

  bool get isMocked => value != null || onceQueue.isNotEmpty;
}

/// The registry the app's seams route through, and the service drives over `ext.wdio.*`.
class WdioMockRegistry {
  final Map<String, _MockEntry> _entries = {};

  _MockEntry _entry(String target) => _entries.putIfAbsent(target, () => _MockEntry());

  void _record(_MockEntry entry, List<dynamic> args) {
    entry.calls.add(args);
    entry.invocationCallOrder.add(_invocationCounter++);
  }

  /// Route a synchronous seam: records the call, returns the mocked value if one is set
  /// (`return` kind; `reject` throws), else the real implementation.
  T intercept<T>(String target, List<dynamic> args, T Function() real) {
    final entry = _entry(target);
    _record(entry, args);
    final spec = entry.takeValue();
    if (spec == null) {
      // Record a 'throw' result too if the real impl raises, so calls/results stay 1:1
      // (the WDIO outer mock's update() relies on that invariant).
      try {
        final value = real();
        entry.results.add({'type': 'return', 'value': value});
        return value;
      } catch (error) {
        entry.results.add({'type': 'throw', 'value': error.toString()});
        rethrow;
      }
    }
    if (spec['kind'] == 'reject') {
      entry.results.add({'type': 'throw', 'value': spec['value']});
      throw _WdioMockException(spec['value']);
    }
    final value = _castMockValue<T>(spec['value']);
    entry.results.add({'type': 'return', 'value': value});
    return value;
  }

  /// Route an asynchronous (Future-returning) seam: supports `return`, `resolve`, `reject`.
  Future<T> interceptAsync<T>(String target, List<dynamic> args, Future<T> Function() real) async {
    final entry = _entry(target);
    // Reserve this call's slot synchronously (before any await) so concurrent calls to the same
    // seam keep calls[i] ↔ results[i] aligned even if their futures complete out of order — the
    // result is written back by index, not appended on completion.
    final index = entry.calls.length;
    entry.calls.add(args);
    entry.invocationCallOrder.add(_invocationCounter++);
    // 'incomplete' is the Vitest-compatible marker for an in-flight call: if update() reads
    // getCalls before this future settles, the outer mock surfaces it as `{ type: 'incomplete' }`
    // (matching Vitest), then it's overwritten with the settled result by index below.
    entry.results.add({'type': 'incomplete', 'value': null});
    final spec = entry.takeValue();
    if (spec == null) {
      try {
        final value = await real();
        entry.results[index] = {'type': 'return', 'value': value};
        return value;
      } catch (error) {
        entry.results[index] = {'type': 'throw', 'value': error.toString()};
        rethrow;
      }
    }
    if (spec['kind'] == 'reject') {
      entry.results[index] = {'type': 'throw', 'value': spec['value']};
      throw _WdioMockException(spec['value']);
    }
    final value = _castMockValue<T>(spec['value']);
    entry.results[index] = {'type': 'return', 'value': value};
    return value;
  }

  /// Set a mocked value for `target`. `spec` is `{kind, value, once}` from the service.
  void setMock(String target, Map<String, dynamic> spec) {
    final entry = _entry(target);
    if (spec['once'] == true) {
      entry.onceQueue.add(spec);
    } else {
      entry.value = spec;
    }
  }

  /// Read the recorded call data for `target` (for the outer mock's update()).
  Map<String, dynamic> getCalls(String target) {
    final entry = _entries[target];
    if (entry == null) {
      return {'calls': [], 'results': [], 'invocationCallOrder': []};
    }
    return {
      'calls': entry.calls,
      'results': entry.results,
      'invocationCallOrder': entry.invocationCallOrder,
    };
  }

  /// Clear the recorded call data for `target` (mockClear) — keep the mocked value.
  void clearMock(String target) {
    final entry = _entries[target];
    entry?.calls.clear();
    entry?.results.clear();
    entry?.invocationCallOrder.clear();
  }

  /// Clear value + call data for `target` (mockReset).
  void resetMock(String target) {
    final entry = _entries[target];
    if (entry == null) return;
    entry.value = null;
    entry.onceQueue.clear();
    clearMock(target);
  }

  /// Remove `target` from the registry entirely (mockRestore).
  void restoreMock(String target) {
    _entries.remove(target);
  }
}

class _WdioMockException implements Exception {
  _WdioMockException(this.value);
  final dynamic value;
  @override
  String toString() => 'WdioMockException: $value';
}

/// The single registry instance the app wires its seams to.
final WdioMockRegistry wdioRegistry = WdioMockRegistry();

bool _enabled = false;

/// Register the `ext.wdio.*` Dart VM service extensions.
///
/// Call once at startup, AFTER `enableFlutterDriverExtension()` (which initializes the
/// binding) and BEFORE `runApp()`. Idempotent.
void enableWdioMocking() {
  if (_enabled) return;
  _enabled = true;

  developer.registerExtension('ext.wdio.setMock', (method, params) async {
    final target = params['target'];
    if (target == null) return _missingParam('target');
    final spec = jsonDecode(params['value'] ?? '{}') as Map<String, dynamic>;
    wdioRegistry.setMock(target, spec);
    return _ok();
  });

  developer.registerExtension('ext.wdio.getCalls', (method, params) async {
    final target = params['target'];
    if (target == null) return _missingParam('target');
    return developer.ServiceExtensionResponse.result(jsonEncode(wdioRegistry.getCalls(target)));
  });

  developer.registerExtension('ext.wdio.clearMock', (method, params) async {
    final target = params['target'];
    if (target == null) return _missingParam('target');
    wdioRegistry.clearMock(target);
    return _ok();
  });

  developer.registerExtension('ext.wdio.resetMock', (method, params) async {
    final target = params['target'];
    if (target == null) return _missingParam('target');
    wdioRegistry.resetMock(target);
    return _ok();
  });

  developer.registerExtension('ext.wdio.restoreMock', (method, params) async {
    final target = params['target'];
    if (target == null) return _missingParam('target');
    wdioRegistry.restoreMock(target);
    return _ok();
  });
}

developer.ServiceExtensionResponse _ok() =>
    developer.ServiceExtensionResponse.result(jsonEncode({'ok': true}));

developer.ServiceExtensionResponse _missingParam(String name) =>
    developer.ServiceExtensionResponse.error(
      developer.ServiceExtensionResponse.invalidParams,
      jsonEncode({'error': "missing required param '$name'"}),
    );
