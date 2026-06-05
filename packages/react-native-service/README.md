# @wdio/react-native-service

> **Status: experimental, in development.** This package is being built up across a
> stack of PRs. The launcher/worker service, `execute`, and `mock` are not yet wired
> — this release contains the foundation only.

WebdriverIO service for testing **React Native** mobile applications on Android and iOS.

React Native is a hybrid target: native find/tap runs over the Appium W3C session
(UiAutomator2 / XCUITest), while `execute` and `mock` run in the app's **Hermes** JS
realm over the Chrome DevTools Protocol, attached through **Metro's inspector-proxy**.

## Foundation (this release)

The shared CDP transport from [`@wdio/native-cdp-bridge`](../native-cdp-bridge) is
configured for React Native:

```ts
import { createHermesBridge } from '@wdio/react-native-service';

// Defaults to Metro at localhost:8081, selects the live Hermes target, and sets
// the Origin header Fusebox's inspector-proxy CSRF check requires.
const bridge = createHermesBridge();
await bridge.connect();
const result = await bridge.send('Runtime.evaluate', {
  expression: 'typeof HermesInternal',
  returnByValue: true,
});
await bridge.close();
```

The public type surface (`browser.reactNative.*`) ships in
[`@wdio/native-types`](../native-types).

## Documentation

Full setup, capabilities, and API docs land alongside the complete service.
