# @wdio/electrobun-service

WebdriverIO service for end-to-end testing [Electrobun](https://electrobun.dev)
desktop applications — the TypeScript-first, Bun-powered desktop framework.

It mirrors the surface of the sibling services (`@wdio/electron-service`,
`@wdio/tauri-service`, `@wdio/dioxus-service`): `browser.electrobun.execute`,
Vitest-style mocking, log capture, browser mode, and standalone sessions.

> **Status: `0.x.y`, pre-1.0 — macOS (CEF), Windows (WebView2), and Linux (WebKitGTK).**
> See [Automation coverage](#automation-coverage-os--renderer) for the per-OS matrix. It's still a
> `0.x` release because the **macOS CEF** path has multiremote and deeplink blocked upstream; `1.0`
> is reserved for full parity once those gaps are filled
> ([#317](https://github.com/webdriverio/desktop-mobile/issues/317) +
> [#320](https://github.com/webdriverio/desktop-mobile/issues/320) track the work).

## Installation

```sh
npm install --save-dev @wdio/electrobun-service
```

The service supports WebdriverIO 9.33.0+ and 10.2.0+. To use it standalone, without the test runner, also install `webdriverio`:

```sh
npm install --save-dev @wdio/electrobun-service webdriverio
```

Start a standalone session with `startWdioSession()`, and end it with `cleanupWdioSession(browser)`, which runs the service's `after` and `afterSession` hooks, deletes the session and stops the app and driver. `browser.deleteSession()` alone skips that cleanup.

## Automation coverage (OS × renderer)

Electrobun renders through either the **OS's native webview** (WKWebView on macOS, WebView2 on
Windows, WebKitGTK on Linux) or a **bundled CEF** (Chromium) renderer. The service drives whichever
exposes an automation surface: **CDP** for the Chromium-based renderers — macOS CEF and Windows
WebView2, where the launcher spawns the app and a Chromedriver attaches via `debuggerAddress` — and
**W3C WebDriver** for Linux WebKitGTK, where `WebKitWebDriver` launches the app and drives it
directly. Build each OS with its drivable renderer:

| OS          | Renderer  | Automation surface              | Transport           | Status                                                                                                                                                                               |
| ----------- | --------- | ------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **macOS**   | CEF       | CDP                             | Chromedriver attach | ✅ supported — recommended macOS path                                                                                                                                                |
| **macOS**   | WKWebView | none (local Web Inspector only) | —                   | ❌ unsupported — no remote automation surface; build with CEF. A future self-shipped embedded driver is tracked in [#629](https://github.com/webdriverio/desktop-mobile/issues/629). |
| **Windows** | WebView2  | CDP                             | msedgedriver attach | ✅ supported — multi-window + multiremote                                                                                                                                            |
| **Windows** | CEF       | —                               | —                   | ❌ unsupported — CEF can't create its profile on Windows; use the native renderer                                                                                                    |
| **Linux**   | WebKitGTK | W3C WebDriver                   | `WebKitWebDriver`   | ✅ supported — single-window ([requirements](#linux-webkitgtk-requirements))                                                                                                         |
| **Linux**   | CEF       | —                               | —                   | ❌ unsupported — CEF serves no `/json` off macOS ([upstream #380](https://github.com/blackboardsh/electrobun/issues/380)); use the native renderer                                   |

```ts
// electrobun.config.ts — build each OS with its drivable renderer
export default {
  build: {
    mac: { bundleCEF: true, defaultRenderer: 'cef' }, // WKWebView can't be driven → use CEF over CDP
    win: { bundleCEF: false, defaultRenderer: 'native' }, // WebView2 over CDP
    linux: { bundleCEF: false, defaultRenderer: 'native' }, // WebKitGTK over W3C WebDriver
  },
};
```

A build with the **wrong renderer for its OS** (the ❌ rows above) is an explicit, documented
unsupported configuration — the launcher fails fast with a clear error.

### Linux (WebKitGTK) requirements

The Linux path drives the native WebKitGTK renderer over **W3C WebDriver** via
**`WebKitWebDriver`**, which launches the app. The app runs on X11, because it doesn't start under a
headless Weston. If an X display is set (`DISPLAY`), such as your desktop's, the service uses it.
Otherwise, including when only a Wayland display is set, it runs the driver under `xvfb-run`. Install
both the WebKitGTK driver and Xvfb:

```sh
sudo apt-get install webkitgtk-webdriver xvfb     # Ubuntu 26.04+, Debian 13+
# apt-get install webkit2gtk-driver xvfb          # Ubuntu 24.04 and older, Debian 12
# dnf install webkitgtk6.0 xorg-x11-server-Xvfb   # Fedora
# pacman -S webkitgtk-6.0 xorg-server-xvfb        # Arch
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

DOM nodes and lists in the result:

- An element or shadow root comes back as a W3C reference, so pass it to `browser.$()` to get an element.
  On Linux, WebKitWebDriver returns a shadow root as an element reference instead
  ([#1052](https://github.com/webdriverio/desktop-mobile/issues/1052)).
- An iterable with a numeric length, such as a `NodeList`, an `HTMLCollection` or a typed array, comes back
  as an array.
- A result that holds an element or a list goes through `JSON.stringify`'s rules, so a `Date` in it comes
  back as a string, for example.
- The service reads the references through the WebDriver session. Switch windows with
  `browser.electrobun.switchWindow()`, which moves the session too, and don't leave the session in a frame.
- Unlike with `browser.execute()`, an element passed as an argument reaches the script as a plain object,
  because the arguments are inlined as JSON.

## Supported surface (macOS + Windows + Linux)

| Feature                                                                 | Status                                                                                                                       |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `execute`                                                               | ✅                                                                                                                           |
| mocking (`mock` + `clear`/`reset`/`restoreAllMocks` + `isMockFunction`) | ✅                                                                                                                           |
| frontend + backend log capture                                          | ✅ (Linux: frontend via an injected console shim + the driver's stdout; `captureBackendLogs` structured capture is CDP-only) |
| browser mode (`mode: 'browser'` against a dev server)                   | ✅ (the page runs in plain Chrome without `browser.electrobun`, so the service's `execute` and `mock` aren't available)      |
| standalone / session mode                                               | ✅                                                                                                                           |

The **`clearMocks`**, **`resetMocks`** and **`restoreMocks`** service options clear, reset or restore every mock before each test, like calling `clearAllMocks()`, `resetAllMocks()` or `restoreAllMocks()` in a `beforeEach`. Their prefix options (`clearMocksPrefix`, `resetMocksPrefix` and `restoreMocksPrefix`) limit each to the mocks under a target path: `'api'` covers `api.*`. In multiremote, each instance applies the three options, and their prefixes, from its own `wdio:electrobunServiceOptions` to its own mocks. An instance that doesn't set an option uses the service-level value.

All capabilities in a run must use the same `mode`; mixing `'native'` and `'browser'` throws a `SevereServiceError`. In browser mode, each capability opens its own `devServerUrl`, or the service-level one if it sets none.

Browser mode also supports the optional **`devServer`** service option — the launcher spawns your dev server in `onPrepare`, waits until `devServerUrl` is reachable, and tears it down afterwards (and on a startup failure). It accepts a shell command (`'pnpm dev'`), a config object (`{ command, cwd, env, timeoutMs, reuseExistingServer }`), or an `async () => ({ url, close })` function.

- `devServer` is service-level only: the service ignores it in a capability.
- Every capability opens the managed server's URL, in place of its own `devServerUrl`. With the string or object form, set `devServerUrl` in the service options: it is the URL the service waits for.
- `reuseExistingServer` defaults to reusing a running server locally and always spawning fresh in CI.
- In standalone mode, pass `devServer` in the global options, `startWdioSession()`'s second argument. A dev server started from a command (the string or object form) belongs to the session that started it. Until that session's `cleanupWdioSession()` stops it, another session in the same process can't use a command-form `devServer` at the same URL. To share a server between concurrent sessions, start it yourself and pass `devServerUrl` without `devServer`, or run the sessions in separate processes.

## Options

Set options on the service, or per capability in `wdio:electrobunServiceOptions`. A capability's value takes precedence over the service's, except for the options marked service level only.

| Option                       | Type                     | Default    | Description                                                                                                                                                                                                              |
| ---------------------------- | ------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `appBinaryPath`              | `string`                 | —          | The built app: the `.app` bundle on macOS, `…\bin\launcher.exe` on Windows. Required in native mode; the service doesn't detect it.                                                                                      |
| `appArgs`                    | `string[]`               | `[]`       | Arguments passed to the app.                                                                                                                                                                                             |
| `env`                        | `Record<string, string>` | —          | Environment variables for the app, merged over the test process's. Ignored on Linux, where WebKitWebDriver launches the app ([#935](https://github.com/webdriverio/desktop-mobile/issues/935)).                          |
| `mode`                       | `'native' \| 'browser'`  | `'native'` | `'browser'` runs the frontend in Chrome against `devServerUrl`. See [Supported surface](#supported-surface-macos--windows--linux).                                                                                       |
| `devServerUrl`               | `string`                 | —          | The dev server URL each browser-mode session opens.                                                                                                                                                                      |
| `devServer`                  | see above                | —          | Starts and stops the dev server in browser mode. Service level only.                                                                                                                                                     |
| `remoteDebuggingPort`        | `number`                 | `9333`     | The port the launcher tries first: CDP on macOS and Windows, WebKitWebDriver on Linux. If it's taken, including by another instance in the run, the launcher picks a free port. Service level only. Usually unnecessary. |
| `cdpConnectionTimeout`       | `number`                 | `10000`    | Milliseconds to wait for the CDP port to open, and for each CDP request. macOS and Windows.                                                                                                                              |
| `cdpConnectionRetryCount`    | `number`                 | `3`        | Times to retry connecting once the CDP port is open. macOS and Windows.                                                                                                                                                  |
| `cdpConnectionRetryInterval` | `number`                 | `100`      | Milliseconds between those retries. macOS and Windows.                                                                                                                                                                   |
| `captureBackendLogs`         | `boolean`                | `false`    | Writes the app's stdout and stderr to the WebdriverIO log. macOS and Windows.                                                                                                                                            |
| `clearMocks`                 | `boolean`                | `false`    | Clears every mock before each test. `clearMocksPrefix` limits it to the mocks under a target path.                                                                                                                       |
| `resetMocks`                 | `boolean`                | `false`    | Resets every mock before each test. `resetMocksPrefix` limits it to the mocks under a target path.                                                                                                                       |
| `restoreMocks`               | `boolean`                | `false`    | Restores every mock before each test. `restoreMocksPrefix` limits it to the mocks under a target path.                                                                                                                   |

In multiremote, each instance reads the `cdpConnection*` and mock options from its own `wdio:electrobunServiceOptions`.

## Known limitations

Most of these are **upstream Electrobun/CEF limitations**, not service bugs — the service code
implements the full surface and is unit-tested. The macOS root cause: CEF's chrome-runtime can't
create the `persist:default` profile its `BrowserWindow` forces and falls back to a global browser
context, which folds parallel instances together (blocking multiremote). Upstream CEF fixes are
tracked in [#320](https://github.com/webdriverio/desktop-mobile/issues/320); the non-CEF
(native-renderer) track is [#317](https://github.com/webdriverio/desktop-mobile/issues/317).

| Area                           | Status                                                                                                                                                                                                                                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| multiremote / parallel workers | ✅ Windows — WebView2 isolates each instance, so parallel workers and multiremote both work; ✅ Linux — WebKitGTK clones the bundle per instance (each gets its own `WebKitWebDriver` + app), so parallel workers and multiremote both work; ❌ macOS CEF — instances fold together, per the root cause above. |
| `switchWindow` / `listWindows` | ✅ Windows; ⚠️ macOS CEF unreliable — two windows race in the shared global context, so run locally; ⚠️ Linux best-effort — W3C window handles mapped by order.                                                                                                                                                |
| `triggerDeeplink`              | ⚠️ macOS unreliable — no `open-url` routing to the spawned instance; ❌ Windows/Linux upstream-blocked — Electrobun registers URL schemes and wires `open-url` macOS-only ([blackboardsh/electrobun#465](https://github.com/blackboardsh/electrobun/issues/465)).                                              |
| single-window apps             | ⚠️ a lone CEF window doesn't reliably appear in `/json`, so the bridge can intermittently find no target to attach to. Opening a second window stabilises target exposure — the fixtures open it staggered behind the first window's `dom-ready`.                                                              |
| `emitEvent`                    | deferred — the Bun event bus isn't CDP-reachable.                                                                                                                                                                                                                                                              |

As each upstream fix lands, the corresponding platform/feature is re-enabled and
the service advances toward `1.0`.

## License

MIT
