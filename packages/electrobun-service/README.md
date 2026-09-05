# @wdio/electrobun-service

WebdriverIO service for end-to-end testing [Electrobun](https://electrobun.dev)
desktop applications — the TypeScript-first, Bun-powered desktop framework.

It mirrors the surface of the sibling services (`@wdio/electron-service`,
`@wdio/tauri-service`, `@wdio/dioxus-service`): `browser.electrobun.execute`,
Vitest-style mocking, log capture, browser mode, and standalone sessions.

> **Status: `0.1.0`, pre-1.0 — macOS (CEF) + Windows (native WebView2) + Linux (WebKitGTK).**
> Windows uses the native WebView2 (Chromium) renderer over CDP — no CEF — and runs multi-window
> + multiremote. **Linux** drives the native WebKitGTK renderer over W3C WebDriver (electrobun ≥
> 2.0.1; gated in CI); it needs `webkit2gtk-driver` installed and is single-window. This is still
> a `0.x` release because the **macOS CEF** path has multiremote/deeplink blocked by an upstream
> limitation. See [Known limitations](#known-limitations). `1.0` is reserved for full parity
> once those gaps are filled ([#317](https://github.com/webdriverio/desktop-mobile/issues/317) +
> [#320](https://github.com/webdriverio/desktop-mobile/issues/320) track the work).

## Installation

```sh
npm install --save-dev @wdio/electrobun-service
```

## Automation coverage (OS × renderer)

The service drives each platform through whatever automation surface its renderer exposes:
**CDP** for the Chromium renderers (macOS CEF, Windows WebView2 — the launcher spawns the app
and a Chromedriver attaches via `debuggerAddress`), and **W3C WebDriver** for Linux's native
WebKitGTK renderer (`WebKitWebDriver` launches the app and the worker drives it directly).
Build each OS with its drivable renderer:

| OS | Renderer | Automation surface | Transport | Status |
|---|---|---|---|---|
| **macOS** | CEF (bundled Chromium) | CDP | Chromedriver attach | ✅ supported — recommended macOS path |
| **macOS** | WKWebView (native) | none (local Web Inspector only) | — | ❌ unsupported — no remote automation surface; build with CEF. A future self-shipped embedded driver is tracked in [#629](https://github.com/webdriverio/desktop-mobile/issues/629). |
| **Windows** | WebView2 (native, Chromium) | CDP | msedgedriver attach (classic) | ✅ supported — multi-window + multiremote |
| **Windows** | CEF (bundled Chromium) | — | — | ❌ unsupported — CEF can't create its profile on Windows; use the native renderer |
| **Linux** | WebKitGTK (native) | W3C WebDriver | `WebKitWebDriver` (classic) | ✅ supported (electrobun ≥ 2.0.1) — needs `webkit2gtk-driver` installed; single-window |
| **Linux** | CEF (bundled Chromium) | — | — | ❌ unsupported — CEF serves no `/json` off macOS ([upstream #380](https://github.com/blackboardsh/electrobun/issues/380)); use the native renderer |

```ts
// electrobun.config.ts — build each OS with its drivable renderer
export default {
  build: {
    mac: { bundleCEF: true, defaultRenderer: 'cef' }, // WKWebView can't be driven → CEF (CDP)
    win: { bundleCEF: false, defaultRenderer: 'native' }, // WebView2 (Chromium) over CDP
    linux: { bundleCEF: false, defaultRenderer: 'native' }, // WebKitGTK over W3C WebDriver
  },
};
```

A build with the **wrong renderer for its OS** is an explicit, documented unsupported
configuration — the launcher fails fast with a clear error (WKWebView on macOS, or a CEF build
on Windows/Linux where it serves no `/json`).

### Linux (WebKitGTK) requirements

The Linux path drives the native WebKitGTK renderer over **W3C WebDriver** via
**`WebKitWebDriver`**, which the service spawns to launch and drive the app. Install it from
the `webkit2gtk-driver` package:

```sh
sudo apt-get install webkit2gtk-driver   # Debian/Ubuntu
# dnf install webkit2gtk-driver           # Fedora
# pacman -S webkit2gtk-driver             # Arch
```

It requires **electrobun ≥ 2.0.1**, which exposes WebKitGTK automation upstream
([blackboardsh/electrobun#467](https://github.com/blackboardsh/electrobun/issues/467)). No CDP
bridge is used on Linux — `browser.electrobun.execute` and mocking run over the W3C session.

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

## Supported surface (macOS + Windows + Linux)

| Feature | Status |
|---|---|
| `execute` | ✅ |
| mocking (`mock` + `clear`/`reset`/`restoreAllMocks` + `isMockFunction`) | ✅ |
| frontend + backend log capture | ✅ (Linux: frontend via an injected console shim + the driver's stdout; `captureBackendLogs` structured capture is CDP-only) |
| browser mode (`mode: 'browser'` against a dev server) | ✅ |
| standalone / session mode | ✅ |

Browser mode also supports the optional **`devServer`** service option — the launcher spawns your dev server in `onPrepare`, waits until `devServerUrl` is reachable, and tears it down afterwards (and on a startup failure). It accepts a shell command (`'pnpm dev'`), a config object (`{ command, cwd, env, timeoutMs, reuseExistingServer }`), or an `async () => ({ url, close })` function; `reuseExistingServer` defaults to reusing a running server locally and always spawning fresh in CI.

## Known limitations

Most of these are **upstream Electrobun/CEF limitations**, not service bugs — the
service code implements the full surface and is unit-tested. On **macOS**, CEF's
chrome-runtime can't create the `persist:default` profile its `BrowserWindow` forces and
falls back to a global browser context (macOS recovers and serves `/json`; a CEF build off
macOS does not — so **Windows** uses the native WebView2 renderer over CDP and **Linux** uses
the native WebKitGTK renderer over W3C WebDriver instead). The upstream CEF fixes and what each
unblocks are tracked in [#320](https://github.com/webdriverio/desktop-mobile/issues/320); the
non-CEF (native-renderer) track is
[#317](https://github.com/webdriverio/desktop-mobile/issues/317).

| Area | Status |
|---|---|
| **Windows** | ✅ supported via the native **WebView2** (Chromium) renderer over CDP — no CEF (build `bundleCEF: false` / `defaultRenderer: 'native'`, the Electrobun default). |
| **Linux** | ✅ supported via the native **WebKitGTK** renderer over W3C WebDriver (`WebKitWebDriver`, electrobun ≥ 2.0.1; gated in CI). Build `bundleCEF: false` / `defaultRenderer: 'native'`; install `webkit2gtk-driver`. Single-window (`switchWindow`/`listWindows` are best-effort). A CEF build on Linux is unsupported (serves no `/json`). |
| multiremote / parallel workers | ✅ Windows (WebView2 isolates each instance — its own process + `LOCALAPPDATA` data dir); ✅ Linux parallel workers (each gets its own `WebKitWebDriver` + app); ❌ macOS CEF (shared `root_cache_path` → instance folding). Linux multiremote (multiple instances per worker) not yet wired. |
| `switchWindow` / `listWindows` (multi-window) | ✅ on Windows (WebView2, gated in CI); ⚠️ macOS CEF unreliable (2-window global-context race — run locally); ⚠️ Linux best-effort (W3C window handles, mapped by order). |
| `triggerDeeplink` | ⚠️ macOS — unreliable (no open-url routing to the spawned instance); ❌ Windows/Linux — upstream-blocked: Electrobun registers URL schemes + wires `open-url` macOS-only ([blackboardsh/electrobun#465](https://github.com/blackboardsh/electrobun/issues/465)). |
| single-window apps | ⚠️ a lone CEF window doesn't reliably appear in `/json`, so the bridge can intermittently find no target to attach to. Opening a second window stabilises target exposure (the test fixtures do this, staggered behind the first window's `dom-ready`). |
| `emitEvent` | deferred — the Bun event bus isn't CDP-reachable. |

As each upstream fix lands, the corresponding platform/feature is re-enabled and
the service advances toward `1.0`.

## License

MIT
