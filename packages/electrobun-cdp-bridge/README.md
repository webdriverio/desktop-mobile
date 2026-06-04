# @wdio/electrobun-cdp-bridge

Multi-target Chrome DevTools Protocol (CDP) bridge for the
[`@wdio/electrobun-service`](../electrobun-service). It attaches to the CEF
renderer that an [Electrobun](https://electrobun.dev) app exposes and routes CDP
commands to a specific webview target.

Unlike a single-target CDP client (e.g. `@wdio/electron-cdp-bridge`), Electrobun
apps surface **one CDP page target per webview** — a `BrowserWindow` shell and
each `BrowserView`/OOPIF content webview. This bridge discovers all of them from
the `/json` endpoint, classifies and labels them, and lets the service route
`execute`/mock/log traffic to the active target — backing the standard
`switchWindow` / `listWindows` surface.

> **Status:** pre-release (`1.0.0-next.x`). Part of the staged Electrobun service
> rollout — this PR ships the package foundation (constants + types); the
> connection manager lands in the MVP PR.

## Platform note

CDP is only available when the Electrobun app is built with the **CEF renderer**
(`bundleCEF: true` / `defaultRenderer: 'cef'`). The default WebKit webviews
(WKWebView on macOS, WebKitGTK on Linux) do not speak CDP. See the service
README for details.

## License

MIT
