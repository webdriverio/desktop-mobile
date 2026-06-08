/**
 * React Native E2E Test Fixture — big-glass counter
 *
 * Every element is selected by `testID` (see e2e el(): Android resource-id / iOS
 * accessibilityIdentifier). We do NOT set accessibilityLabel on value-bearing elements:
 * on iOS an accessibilityLabel shadows the element's value, so getText() on the counter
 * would return "counter" instead of the rendered number.
 *
 *   testID: app-title | counter | increment-button | decrement-button | reset-button | status
 */
import React, { useState } from 'react';
import { DeviceEventEmitter, SafeAreaView, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

// Expose a mockable greeting function for execute/mock tests.
(globalThis as { greet?: (name: string) => string }).greet = (name: string) => `Hello, ${name}!`;

// Expose DeviceEventEmitter on the Hermes global so browser.reactNative.emitEvent can reach
// it: Runtime.evaluate runs in global scope where `require` isn't defined (Metro's loader is
// `global.__r`, not a bare `require`), so the service's `require('react-native')` lookup can't
// resolve it. This is the documented `globalThis` fallback in commands/emitEvent.ts.
(globalThis as { DeviceEventEmitter?: typeof DeviceEventEmitter }).DeviceEventEmitter = DeviceEventEmitter;

export default function App(): React.JSX.Element {
  const [count, setCount] = useState(0);
  const [status, setStatus] = useState('Ready');

  const increment = () => {
    setCount((c) => {
      const next = c + 1;
      setStatus(`Incremented to ${next}`);
      return next;
    });
  };

  const decrement = () => {
    setCount((c) => {
      const next = c - 1;
      setStatus(`Decremented to ${next}`);
      return next;
    });
  };

  const reset = () => {
    setCount(0);
    setStatus('Reset');
  };

  // Allow tests to drive the counter via DeviceEventEmitter.
  React.useEffect(() => {
    const sub = DeviceEventEmitter.addListener('wdio:setCount', (value: number) => {
      setCount(value);
      setStatus(`Set to ${value} via event`);
    });
    return () => sub.remove();
  }, []);

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#667eea" />
      <View style={styles.container}>
        <Text testID="app-title" style={styles.title}>
          React Native E2E App
        </Text>

        <View style={styles.counterSection}>
          <Text testID="counter" style={styles.counter}>
            {count}
          </Text>
        </View>

        <View style={styles.buttons}>
          <TouchableOpacity testID="increment-button" style={styles.button} onPress={increment}>
            <Text style={styles.buttonText}>+</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="decrement-button" style={styles.button} onPress={decrement}>
            <Text style={styles.buttonText}>−</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="reset-button" style={styles.button} onPress={reset}>
            <Text style={styles.buttonText}>Reset</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.infoSection}>
          <Text testID="status" style={styles.status}>
            {status}
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#667eea',
  },
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 50,
    margin: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 25,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  title: {
    fontSize: 28,
    fontWeight: '200',
    color: 'white',
    marginBottom: 25,
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  counterSection: {
    marginVertical: 20,
  },
  counter: {
    fontSize: 72,
    fontWeight: 'bold',
    color: '#61dafb',
    textAlign: 'center',
  },
  buttons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  button: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.4)',
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 15,
    margin: 8,
  },
  buttonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '500',
  },
  infoSection: {
    marginTop: 40,
    padding: 25,
    backgroundColor: 'rgba(0,0,0,0.25)',
    borderRadius: 15,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    width: '100%',
  },
  status: {
    color: 'white',
    fontSize: 14,
    fontFamily: 'monospace',
    textAlign: 'center',
  },
});
