# Phase 2 — CDP-attach plumbing (Chromium-based runtimes)

For Chromium-based runtimes that expose a Chrome DevTools Protocol endpoint. The test process attaches a WebSocket CDP client directly — **no driver subprocess and no in-app Rust crate**. The shipped reference is `@wdio/electron-service` (`packages/electron-service/`).

## What you build

| Piece | Package | Job |
|---|---|---|
| Service | `@wdio/<framework>-service` | binary detection, launch, capability mutation, CDP attach, mock surface |
| CDP transport | **reuse `@wdio/native-cdp-bridge`** (shared) | WebSocket client to the DevTools protocol; endpoint/target discovery |

There is **no** automation env var, no `<framework>:options` capability, no `wdio://` protocol, no guest-js. The runtime is already debuggable.

## CDP transport — reuse the shared `@wdio/native-cdp-bridge`

The CDP transport is a **shared package** (`packages/native-cdp-bridge/`), used by Electrobun and React Native (Hermes) and slated to absorb Electron next. A new CDP service **reuses it** — don't author a per-framework bridge. `@wdio/electron-cdp-bridge` (`packages/electron-cdp-bridge/`) is the **legacy per-framework instance** that predates the shared extraction; treat it as historical, not a template.

`@wdio/native-cdp-bridge` exports the pieces a new service needs: `CdpBridge` (single-target), `MultiTargetCdpBridge` (multi-window/target), a `DevTool` endpoint-discovery client, a `SelectTarget` hook for picking the right target, and an `origin` option (a custom CSRF header — e.g. React Native's Fusebox `Origin`). Construct it against the runtime's debugger host/port; supply a `selectTarget` if the runtime exposes several targets.

The legacy `electron-cdp-bridge` shows the underlying shape (mirror it only if you ever must fork the transport):

```
src/
├── index.ts      barrel re-export (bridge + devTool + types)
├── bridge.ts     CdpBridge: EventEmitter wrapping a ws connection; typed send()/on() over devtools-protocol
├── devTool.ts    discovers the debugger WebSocket URL from the runtime's /json endpoint
├── constants.ts  default host/port, retry interval, timeouts
└── types.ts
```

Key points from `electron-cdp-bridge/src/bridge.ts` (the shared `native-cdp-bridge` follows the same model):

- Wrap `ws` in an `EventEmitter`. Type `send()` against `devtools-protocol/types/protocol-mapping.js` so command params/returns are checked.
- Maintain a `Map<commandId, {resolve, reject}>`; the connect promise uses id `0`.
- `CdpBridgeOptions` extends `DevToolOptions` with `waitInterval` + `connectionRetryCount`; `devTool.ts` polls the `/json`-style endpoint until the debugger URL is available, then `bridge.ts` connects.

## Service launcher (CDP)

In `launcher.ts` (`onPrepare`):

1. **Detect the binary / build output.** Electron does this via `appBuildInfo.ts` (Forge/Builder config), `binaryPath.ts`, `electronVersion.ts`, `pathResolver.ts`. For a new framework, detect the built app the equivalent way (e.g. read the framework's build config, resolve the platform binary path).
2. **Decide the debugger port.** Define your own override (service option + env var) rather than hardcoding or depending on a framework's built-in env var. A runtime may have a conventional default port, but the service should own the override mechanism so multiremote/parallel runs can allocate distinct ports.
3. **Launch** the app with the remote-debugging flag/port, or let the runtime expose it, then hand the port to the worker via capabilities.
4. **Attach** the `CdpBridge` and wait for the endpoint to come up.

Browser mode (testing against a dev server in a normal Chrome) skips all of this — see `electron-service/test/launcher.browser.spec.ts`.

## Service worker (CDP)

`service.ts` installs `browser.<framework>.*`. `execute` / mocking run over CDP `Runtime.evaluate` / `Runtime.callFunctionOn`. Electron's mock implementation lives in `mock.ts` / `mockFactory.ts` / `classMock.ts` / `mockStore.ts` — clone the shapes, backed by `@wdio/native-spy`.

## Build notes

- The Electron service ships a **dual ESM/CJS** build (`src/cjs`, `wdio-bundler.config.ts` via `@wdio/bundler`) because some Electron consumers are CJS. Match the consumer's needs; a pure-ESM framework can skip the CJS half.
- No Rust toolchain, no GTK libraries, no crates.io publishing — the release scope lists just `@wdio/<framework>-service` (the shared `@wdio/native-cdp-bridge` releases on its own scope; you don't publish a per-framework bridge). See [ci-and-release.md](ci-and-release.md).

## Multi-target CDP frameworks

Electron attaches to one main target with automatic window focus. A framework that exposes **multiple addressable CDP targets** (e.g. out-of-process iframes / per-tab webviews) needs more than Electron's single-target model — plan for it in the spike:

- **Target routing / multi-target session management** — use the shared bridge's `MultiTargetCdpBridge`; classify targets (e.g. shell vs per-tab) and map them onto the standard `switchWindow`/`listWindows` surface (see [features.md](features.md)).
- **Don't navigate on attach** — attaching should be observation/input only. Issuing `Page.navigate` on attach would destroy the app's current state. Attach to the live target, don't reload it.
- **Own your port allocation** — the service controls the debugger port per instance (above), not a framework default, so parallel/multiremote targets don't collide.
