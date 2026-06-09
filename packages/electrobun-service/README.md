# @wdio/electrobun-service

WebdriverIO service for end-to-end testing [Electrobun](https://electrobun.dev)
desktop applications — the TypeScript-first, Bun-powered desktop framework.

It mirrors the surface of the sibling services (`@wdio/electron-service`,
`@wdio/tauri-service`, `@wdio/dioxus-service`): `browser.electrobun.execute`,
Vitest-style mocking, log capture, browser mode, and standalone sessions.

> **Status: `0.1.0` — macOS-only, pre-1.0.** This is a `0.x` release because the
> CEF renderer Electrobun apps must be built with cannot currently be driven on
> Linux/Windows, and multiremote/multi-window/deeplink are blocked by the same
> upstream limitation. See [Known limitations](#known-limitations). `1.0` is
> reserved for full parity once those gaps are filled
> ([#317](https://github.com/webdriverio/desktop-mobile/issues/317) tracks the work).

## Installation

```sh
npm install --save-dev @wdio/electrobun-service
```

## Platform requirement: the CEF renderer

This is a **CDP-attach** service — it drives the app through the Chrome DevTools
Protocol (the launcher spawns the app binary and WebdriverIO attaches via
Chromedriver's `debuggerAddress`). Electrobun's default webview engine differs
per platform and only the Chromium-based ones speak CDP:

| Platform | Default webview | CDP? |
|---|---|---|
| Windows | WebView2 (Chromium) | ✅ |
| macOS | WKWebView (WebKit) | ❌ |
| Linux | WebKitGTK (WebKit) | ❌ |

So the service requires the app under test to be built with Electrobun's **CEF
renderer**:

```ts
// electrobun.config.ts
export default {
  build: {
    mac: { bundleCEF: true, defaultRenderer: 'cef' },
  },
};
```

Apps built with the default WebKit renderer are an explicit, documented
unsupported configuration — the launcher fails fast with a clear error.

## Quick start

```ts
// wdio.conf.ts
export const config = {
  services: ['electrobun'],
  capabilities: [
    {
      // The launcher rewrites this to 'chrome' + sets the CDP debuggerAddress.
      browserName: 'electrobun',
      // Pin Chromedriver to the CEF Chromium major (147 for current Electrobun).
      browserVersion: '147',
      'wdio:electrobunServiceOptions': {
        appBinaryPath: '/path/to/build/<env>/MyApp.app',
      },
    },
  ],
  // ...mocha/spec config
};
```

```ts
// a spec
const title = await browser.electrobun.execute(() => document.title);
expect(title).toBe('My App');
```

## Supported surface (macOS)

| Feature | Status |
|---|---|
| `execute` | ✅ |
| mocking (`mock` + `clear`/`reset`/`restoreAllMocks` + `isMockFunction`) | ✅ |
| frontend + backend log capture | ✅ |
| browser mode (`mode: 'browser'` against a dev server) | ✅ |
| standalone / session mode | ✅ |

## Known limitations

Most of these are **upstream Electrobun/CEF limitations**, not service bugs — the
service code implements the full surface and is unit-tested. CEF's chrome-runtime
can't create the `persist:default` profile its `BrowserWindow` forces and falls back
to a global browser context; macOS recovers (serves `/json`), Linux does not.
**Windows is driven instead via the native WebView2 (Chromium) renderer over CDP — no
CEF.** The upstream CEF fixes and what each unblocks are tracked in
[#320](https://github.com/webdriverio/desktop-mobile/issues/320); the non-CEF
(native-renderer) track is
[#317](https://github.com/webdriverio/desktop-mobile/issues/317).

| Area | Status |
|---|---|
| **Windows** | ✅ supported via the native **WebView2** (Chromium) renderer over CDP — no CEF (build `bundleCEF: false` / `defaultRenderer: 'native'`, the Electrobun default). |
| **Linux** | ❌ unsupported — CEF serves no `/json`, and the native WebKitGTK renderer needs upstream WebDriver-automation support ([#317](https://github.com/webdriverio/desktop-mobile/issues/317)). The launcher throws a clear `SevereServiceError` in native mode. |
| multiremote / parallel workers | ✅ Windows (WebView2 isolates each instance — its own process + `LOCALAPPDATA` data dir); ❌ macOS CEF (shared `root_cache_path` → instance folding). |
| `switchWindow` / `listWindows` (multi-window) | ✅ on Windows (WebView2, gated in CI); ⚠️ macOS CEF unreliable (2-window global-context race — run locally). |
| `triggerDeeplink` | ⚠️ macOS — unreliable (no open-url routing to the spawned instance); ❌ Windows — upstream-blocked: Electrobun registers URL schemes + wires `open-url` macOS-only ([blackboardsh/electrobun#465](https://github.com/blackboardsh/electrobun/issues/465)). |
| single-window apps | ⚠️ a lone CEF window doesn't reliably appear in `/json`, so the bridge can intermittently find no target to attach to. Opening a second window stabilises target exposure (the test fixtures do this, staggered behind the first window's `dom-ready`). |
| `emitEvent` | deferred — the Bun event bus isn't CDP-reachable. |

As each upstream fix lands, the corresponding platform/feature is re-enabled and
the service advances toward `1.0`.

## License

MIT
