# @wdio/electrobun-service

WebdriverIO service for end-to-end testing [Electrobun](https://electrobun.dev)
desktop applications — the TypeScript-first, Bun-powered desktop framework.

It mirrors the surface of the sibling services (`@wdio/electron-service`,
`@wdio/tauri-service`, `@wdio/dioxus-service`): `browser.electrobun.execute`,
Vitest-style mocking, multi-window `switchWindow`/`listWindows`, log capture,
browser mode, standalone sessions, and multiremote.

> **Status:** pre-release (`1.0.0-next.x`). Shipping in stages (Foundation →
> MVP → Feature-complete → Ship). This package currently provides the
> foundation; `execute`/mocking/etc. arrive in subsequent releases.

## Platform requirement: the CEF renderer

This is a **CDP-attach** service — it drives the app through the Chrome DevTools
Protocol. Electrobun's webview engine differs per platform:

| Platform | Default webview | CDP? |
|---|---|---|
| Windows | WebView2 (Chromium) | ✅ |
| macOS | WKWebView (WebKit) | ❌ |
| Linux | WebKitGTK (WebKit) | ❌ |

Because the default WebKit webviews on macOS/Linux do **not** speak CDP, this
service requires the app under test to be built with Electrobun's **CEF
renderer** on every platform, for a single uniform Chromium target model:

```ts
// electrobun.config.ts
export default {
  build: {
    mac: { bundleCEF: true, defaultRenderer: 'cef' },
    win: { bundleCEF: true, defaultRenderer: 'cef' },
    linux: { bundleCEF: true, defaultRenderer: 'cef' },
  },
};
```

Apps built with the default WebKit renderer are an explicit, documented
unsupported configuration — the launcher fails fast with a clear error.

## License

MIT
