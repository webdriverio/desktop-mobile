# React Native E2E Test App

A minimal React Native "big-glass counter" used by `@wdio/react-native-service`
E2E tests. Runs on **both Android and iOS**.

## Structure

```
react-native/
├── App.tsx            # The counter UI + globalThis.greet + DeviceEventEmitter hook
├── index.js           # AppRegistry entry point
├── app.json           # App name (ReactNativeE2EApp)
├── babel.config.js    # @react-native/babel-preset
├── metro.config.js    # Metro bundler config
├── tsconfig.json
├── android/           # generated — not committed (see below)
└── ios/               # generated — not committed (see below)
```

The native `android/` and `ios/` projects are **generated**, not checked in — they
are large, platform-toolchain-specific, and reproducible. CI (PR4) regenerates them
with `npx @react-native-community/cli init` pinned to the `react-native` version in
`package.json`, then overlays `App.tsx` / `index.js` / `app.json`.

## Stable selectors

Every interactive element exposes a stable `accessibilityLabel` (= Appium
accessibility id) and `testID`:

| Selector | Element |
|----------|---------|
| `app-title` | Title text |
| `counter` | The current count |
| `increment-button` | `+` |
| `decrement-button` | `−` |
| `reset-button` | `Reset` |
| `status` | Last-action status line |

## Hooks for `execute` / `mock` / `emitEvent`

- `globalThis.greet(name)` — a plain function in the Hermes realm, used to exercise
  `browser.reactNative.execute` and `browser.reactNative.mock('greet')`.
- `DeviceEventEmitter.emit('wdio:setCount', n)` — sets the counter, used to exercise
  `browser.reactNative.emitEvent('wdio:setCount', n)`.

## Running locally

```bash
# Android (emulator must be booted)
pnpm build:android && pnpm android

# iOS (simulator)
pnpm build:ios && pnpm ios

# Metro (debug builds attach the Hermes inspector here, port 8081)
pnpm start
```

> **Hermes + Metro required.** `execute`/`mock`/`emitEvent` drive the app's JS realm
> over the Hermes inspector exposed by Metro. Release builds without the inspector
> support native find/tap only.
