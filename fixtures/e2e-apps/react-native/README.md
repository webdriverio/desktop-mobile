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
are large, platform-toolchain-specific, and reproducible. CI scaffolds a complete
stock app with `npx @react-native-community/cli init`, pinned to the `rn-version`
input of the React Native workflows, and overlays only this fixture's `App.tsx` —
the App imports nothing but react-native core, so the stock template builds it
unmodified.

That means **CI never installs this `package.json`** — it documents the app CI
scaffolds, so you can run the fixture locally. `rn-version` is the source of truth
for what actually gets built; `test/scripts/react-native-version-sync.spec.ts`
keeps the two in step, so bump them together.

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
