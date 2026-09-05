# 5. Adopt Electrobun 2.0+ only, unlocking Linux WebKitGTK over W3C WebDriver

Date: 2026-09-05

## Status

Accepted — shipped in [#631](https://github.com/webdriverio/desktop-mobile/pull/631). Amends
[ADR-0004](./0004-electrobun-cdp-under-cef.md).

## Context

[ADR-0004](./0004-electrobun-cdp-under-cef.md) shipped Electrobun support on macOS (CEF) and
Windows (WebView2), both driven over **CDP**, and deferred Linux as "blocked upstream": Electrobun
1.x's default WebKitGTK renderer exposed no automation surface at all — no CDP endpoint, and no
W3C-WebDriver path — so there was simply nothing to attach to on Linux.

Electrobun **2.0** (a Bun→Zig core rewrite) changed that. Upstream
[electrobun#467](https://github.com/blackboardsh/electrobun/issues/467) (shipped in 2.0.1) exposes
WebKitGTK automation: an app opts in via `--automation` / `ELECTROBUN_WEBKIT_AUTOMATION`, and
`WebKitWebDriver` then drives it over **W3C WebDriver**. Linux support is therefore only possible on
2.0+ — 1.x cannot do it at all. **These are one decision, not two:** adopting 2.0 *is* what enables
Linux.

Electrobun is a new framework with effectively no users, and the users it does have track the latest
release. Carrying 1.x compatibility would cost real complexity — two automation stories, version
branching — for no one's benefit.

## Decision

Require **Electrobun 2.0+** and drop 1.x support. For a new, few-users framework we track the latest
upstream release rather than maintain backward compatibility — the policy that makes the Linux path
possible in the first place.

Adopting 2.0 unlocks the **Linux WebKitGTK** transport, a **W3C-WebDriver** path that sits alongside
the existing CDP-attach paths:

- **macOS** — CEF over CDP (unchanged).
- **Windows** — native WebView2 over CDP (unchanged).
- **Linux** — native WebKitGTK over **W3C WebDriver**: `WebKitWebDriver` *launches* the app (via
  `webkitgtk:browserOptions.binary` + `--automation`) and drives it. There is no CDP endpoint, and
  the service does not spawn the app itself.

This amends ADR-0004's "the default WebKit renderer is unsupported": the WebKit renderer is now
supported on **Linux** via W3C. macOS **WKWebView** still exposes no automation surface and remains
unsupported — a self-shipped embedded driver is tracked separately in
[#629](https://github.com/webdriverio/desktop-mobile/issues/629).

## Consequences

- **Two transport families in one service.** CDP-attach (macOS/Windows — the service spawns the app
  and a Chromedriver/msedgedriver attaches) and W3C (Linux — `WebKitWebDriver` launches the app).
  The `execute` + `mock` machinery is reused over W3C via a small `Runtime.evaluate` adapter that
  posts to `/execute/async` directly, because JSC surfaces page-level throws differently from
  V8/CDP and WDIO's `executeAsync` wrapper mangles the message.
- **Linux runtime specifics.** The service spawns `WebKitWebDriver` under `xvfb-run` on headless CI
  and reaps the app tree on teardown — WebKitWebDriver can't cleanly close its controlled webview,
  so `DELETE /session` otherwise hangs ~120s. Frontend logs come from an injected console shim (no
  CDP console events); `captureBackendLogs` structured capture stays CDP-only.
- **Single-window on Linux for now.** The automation session attaches to the primary app view;
  multi-window / multiremote on Linux are deferred (a second window races the `create-web-view`
  handshake under CI load).
- **A hard `electrobun ≥ 2.0.1` floor.** The E2E fixture moved from 1.18.1 → 2.0.1; there is no 1.x
  fallback, and consumers on 1.x must upgrade.
- **The macOS-CEF caveats from ADR-0004 stand** — deeplink and multiremote on the macOS CEF path
  remain upstream-blocked ([#320](https://github.com/webdriverio/desktop-mobile/issues/320)).
