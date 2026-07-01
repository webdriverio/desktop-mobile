# @wdio/electrobun-service

WebdriverIO service for end-to-end testing [Electrobun](https://electrobun.dev)
desktop applications — the TypeScript-first, Bun-powered desktop framework.

It mirrors the surface of the sibling services (`@wdio/electron-service`,
`@wdio/tauri-service`, `@wdio/dioxus-service`): `browser.electrobun.execute`,
Vitest-style mocking, log capture, browser mode, and standalone sessions.

> **Status: `0.1.0`, pre-1.0 — macOS (CEF) + Windows (native WebView2).** Windows uses the
> native WebView2 (Chromium) renderer over CDP — no CEF — and runs multi-window + multiremote.
> This is still a `0.x` release because **Linux** isn't yet drivable (CEF serves no `/json` off
> macOS; the native WebKitGTK renderer needs upstream automation support), and on the **macOS
> CEF** path multiremote/deeplink remain blocked by an upstream limitation. See
> [Known limitations](#known-limitations). `1.0` is reserved for full parity once those gaps are
> filled ([#317](https://github.com/webdriverio/desktop-mobile/issues/317) +
> [#320](https://github.com/webdriverio/desktop-mobile/issues/320) track the work).

## Installation

```sh
npm install --save-dev @wdio/electrobun-service
```

## Platform requirement: the CEF renderer

This is a **CDP-attach** service — it drives the app through the Chrome DevTools
Protocol (the launcher spawns the app binary and WebdriverIO attaches via
Chromedriver's `debuggerAddress`). Electrobun's default webview engine differs
per platform and only the Chromium-based ones speak CDP:

| Platform | Native webview | CDP? | How the service drives it |
|---|---|---|---|
| Windows | WebView2 (Chromium) | ✅ | the **native WebView2** renderer directly (no CEF) |
| macOS | WKWebView (WebKit) | ❌ | build with the **CEF** renderer (bundled Chromium) |
| Linux | WebKitGTK (WebKit) | ❌ | unsupported (CEF serves no `/json`; WebKitGTK automation is upstream-blocked) |

So the renderer the app must be built with is **per platform** — CEF on macOS, the native
WebView2 on Windows:

```ts
// electrobun.config.ts
export default {
  build: {
    // macOS: WKWebView can't be driven, so build with CEF.
    mac: { bundleCEF: true, defaultRenderer: 'cef' },
    // Windows: the native WebView2 renderer speaks CDP directly — no CEF (this is the default).
    win: { bundleCEF: false, defaultRenderer: 'native' },
  },
};
```

On **macOS**, an app built with the default WKWebView renderer is an explicit, documented
unsupported configuration — the launcher fails fast with a clear error. On **Windows**, a CEF
build is likewise unsupported (CEF can't create its profile there); use the native renderer.

## Quick start

```ts
// wdio.conf.ts
export const config = {
  services: ['electrobun'],
  capabilities: [
    {
      // The launcher rewrites this to 'chrome'/'MicrosoftEdge' + sets the CDP debuggerAddress.
      browserName: 'electrobun',
      // macOS/CEF: pin Chromedriver to the CEF Chromium major (147 for current Electrobun).
      // On Windows, omit this — the launcher pins msedgedriver to the WebView2 runtime version.
      browserVersion: '147',
      'wdio:electrobunServiceOptions': {
        // macOS: the .app bundle; Windows: the built `…\bin\launcher.exe`.
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

## Supported surface (macOS + Windows)

| Feature | Status |
|---|---|
| `execute` | ✅ |
| mocking (`mock` + `clear`/`reset`/`restoreAllMocks` + `isMockFunction`) | ✅ |
| frontend + backend log capture | ✅ |
| browser mode (`mode: 'browser'` against a dev server) | ✅ |
| standalone / session mode | ✅ |

Browser mode also supports the optional **`devServer`** service option — the launcher spawns your dev server in `onPrepare`, waits until `devServerUrl` is reachable, and tears it down afterwards (and on a startup failure). It accepts a shell command (`'pnpm dev'`), a config object (`{ command, cwd, env, timeoutMs, reuseExistingServer }`), or an `async () => ({ url, close })` function; `reuseExistingServer` defaults to reusing a running server locally and always spawning fresh in CI.

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
