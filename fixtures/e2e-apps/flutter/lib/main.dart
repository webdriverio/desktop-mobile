// E2E fixture app for @wdio/flutter-service.
//
// Exercises the full convergent surface the e2e specs drive (PR4 Android / PR5 iOS):
//   - find/tap        : ValueKey('increment') button + ValueKey('counter') text
//   - mock            : GreetingService.greet routed through wdioRegistry (Tier-2 seam)
//   - execute         : top-level `fixtureMarker` + the counter is read via a Dart expression
//   - emitEvent       : listens on wdioEvents.stream and reflects the last event into the UI
//
// Startup order matters: enableFlutterDriverExtension() (initialise the binding) then
// enableWdioMocking() (register ext.wdio.*) BEFORE runApp().

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_driver/driver_extension.dart';
import 'package:wdio_flutter/wdio_flutter.dart';

/// Read by a `browser.flutter.execute('fixtureMarker')` smoke check.
const String fixtureMarker = 'wdio-flutter-fixture';

void main() {
  enableFlutterDriverExtension();
  enableWdioMocking();
  runApp(const WdioFixtureApp());
}

/// A mockable seam: the app calls it through the registry, so `browser.flutter.mock(...)`
/// can override its return value without the app knowing.
class GreetingService {
  Future<String> greet(String name) =>
      wdioRegistry.interceptAsync('GreetingService.greet', [name], () async => 'Hello, $name!');
}

class WdioFixtureApp extends StatelessWidget {
  const WdioFixtureApp({super.key});

  @override
  Widget build(BuildContext context) {
    return const MaterialApp(
      title: 'WDIO Flutter Fixture',
      home: HomeScreen(),
    );
  }
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final GreetingService _greeting = GreetingService();
  int _counter = 0;
  String _greetingText = '';
  String _lastEvent = '';
  StreamSubscription<Map<String, dynamic>>? _eventSub;

  @override
  void initState() {
    super.initState();
    // emitEvent target: reflect the last event the test emits into the UI.
    _eventSub = wdioEvents.stream.listen((event) {
      setState(() => _lastEvent = '${event['name']}:${event['payload']}');
    });
  }

  @override
  void dispose() {
    _eventSub?.cancel();
    super.dispose();
  }

  Future<void> _increment() async {
    final greeting = await _greeting.greet('WDIO');
    setState(() {
      _counter += 1;
      _greetingText = greeting;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('WDIO Flutter Fixture')),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: <Widget>[
            Text('$_counter', key: const ValueKey('counter')),
            Text(_greetingText, key: const ValueKey('greeting')),
            Text(_lastEvent, key: const ValueKey('lastEvent')),
          ],
        ),
      ),
      floatingActionButton: FloatingActionButton(
        key: const ValueKey('increment'),
        onPressed: _increment,
        child: const Icon(Icons.add),
      ),
    );
  }
}
