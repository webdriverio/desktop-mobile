# @wdio/electrobun-service

WebdriverIO service for end-to-end testing [Electrobun](https://electrobun.dev)
desktop applications — the TypeScript-first, Bun-powered desktop framework.

It mirrors the surface of the sibling services (`@wdio/electron-service`,
`@wdio/tauri-service`, `@wdio/dioxus-service`): `browser.electrobun.execute`,
Vitest-style mocking, log capture, browser mode, and standalone sessions.

> **Status: `0.x.y`, pre-1.0 — macOS (CEF), Windows (native WebView2), and Linux (WebKitGTK).**
> See [Automation coverage](#automation-coverage-os--renderer) for the per-OS matrix. It's still a
> `0.x` release because the **macOS CEF** path has multiremote and deeplink blocked upstream; `1.0`
> is reserved for full parity once those gaps are filled
> ([#317](https://github.com/webdriverio/desktop-mobile/issues/317) +
> [#320](https://github.com/webdriverio/desktop-mobile/issues/320) track the work).

## Installation

```sh
npm install --save-dev @wdio/electrobun-service
```

## Automation coverage (OS × renderer)

Electrobun renders through either the **OS's native webview** (WKWebView on macOS, WebView2 on
Windows, WebKitGTK on Linux) or a **bundled CEF** (Chromium) renderer. The service drives whichever
exposes an automation surface: **CDP** for the Chromium-based renderers — macOS CEF and Windows
WebView2, where the launcher spawns the app and a Chromedriver attaches via `debuggerAddress` — and
**W3C WebDriver** for Linux WebKitGTK, where `WebKitWebDriver` launches the app and drives it
directly. Build each OS with its drivable renderer:

| OS | Renderer | Automation surface | Transport | Status |
|---|---|---|---|---|
| **macOS** | CEF | CDP | Chromedriver attach | ✅ supported — recommended macOS path |
| **macOS** | WKWebView | none (local Web Inspector only) | — | ❌ unsupported — no remote automation surface; build with CEF. A future self-shipped embedded driver is tracked in [#629](https://github.com/webdriverio/desktop-mobile/issues/629). |
| **Windows** | WebView2 | CDP | msedgedriver attach (classic) | ✅ supported — multi-window + multiremote |
| **Windows** | CEF | — | — | ❌ unsupported — CEF can't create its profile on Windows; use the native renderer |
| **Linux** | WebKitGTK | W3C WebDriver | `WebKitWebDriver` (classic) | ✅ supported — single-window ([requirements](#linux-webkitgtk-requirements)) |
| **Linux** | CEF | — | — | ❌ unsupported — CEF serves no `/json` off macOS ([upstream #380](https://github.com/blackboardsh/electrobun/issues/380)); use the native renderer |

```ts
// electrobun.config.ts — build each OS with its drivable renderer
export default {
  build: {
    mac: { bundleCEF: true, defaultRenderer: 'cef' }, // WKWebView can't be driven → CEF (CDP)
    win: { bundleCEF: false, defaultRenderer: 'native' }, // WebView2 over CDP
    linux: { bundleCEF: false, defaultRenderer: 'native' }, // WebKitGTK over W3C WebDriver
  },
};
```

A build with the **wrong renderer for its OS** (the ❌ rows above) is an explicit, documented
unsupported configuration — the launcher fails fast with a clear error.

### Linux (WebKitGTK) requirements

The Linux path drives the native WebKitGTK renderer over **W3C WebDriver** via
**`WebKitWebDriver`**, which the service spawns under `xvfb-run` to launch and drive the app on
headless machines. Install both the WebKitGTK driver and Xvfb:

```sh
sudo apt-get install webkit2gtk-driver xvfb            # Debian/Ubuntu
# dnf install webkit2gtk-driver xorg-x11-server-Xvfb   # Fedora
# pacman -S webkit2gtk-driver xorg-server-xvfb         # Arch
```

Native Linux support requires **electrobun ≥ 2.0.1**, which exposes WebKitGTK automation upstream
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

Most of these are **upstream Electrobun/CEF limitations**, not service bugs — the service code
implements the full surface and is unit-tested. The macOS root cause: CEF's chrome-runtime can't
create the `persist:default` profile its `BrowserWindow` forces and falls back to a global browser
context, which folds parallel instances together (blocking multiremote). Upstream CEF fixes are
tracked in [#320](https://github.com/webdriverio/desktop-mobile/issues/320); the non-CEF
(native-renderer) track is [#317](https://github.com/webdriverio/desktop-mobile/issues/317).

| Area | Status |
|---|---|
| multiremote / parallel workers | ✅ Windows (WebView2 isolates each instance — its own process + `LOCALAPPDATA` data dir); ✅ Linux parallel workers (each gets its own `WebKitWebDriver` + app); ❌ macOS CEF (shared `root_cache_path` → instance folding). Linux multiremote (multiple instances per worker) not yet wired. |
| `switchWindow` / `listWindows` (multi-window) | ✅ on Windows (WebView2, gated in CI); ⚠️ macOS CEF unreliable (2-window global-context race — run locally); ⚠️ Linux best-effort (W3C window handles, mapped by order). |
| `triggerDeeplink` | ⚠️ macOS — unreliable (no open-url routing to the spawned instance); ❌ Windows/Linux — upstream-blocked: Electrobun registers URL schemes + wires `open-url` macOS-only ([blackboardsh/electrobun#465](https://github.com/blackboardsh/electrobun/issues/465)). |
| single-window apps | ⚠️ a lone CEF window doesn't reliably appear in `/json`, so the bridge can intermittently find no target to attach to. Opening a second window stabilises target exposure (the test fixtures do this, staggered behind the first window's `dom-ready`). |
| `emitEvent` | deferred — the Bun event bus isn't CDP-reachable. |

As each upstream fix lands, the corresponding platform/feature is re-enabled and
the service advances toward `1.0`.

## License

MIT
