# 4. Electrobun is driven over CDP; the default WebKit renderer is unsupported

Date: 2026-08-03

## Status

Accepted — retroactively documenting the Electrobun service architecture validated in the
Phase-0 spike and shipped in [#314](https://github.com/webdriverio/desktop-mobile/pull/314).

**Amended by [ADR-0005](./0005-electrobun-2-only-linux-webkitgtk.md)** — adopting Electrobun 2.0+
adds a Linux WebKitGTK path over **W3C WebDriver**, so "the default WebKit renderer is unsupported"
no longer holds universally (Linux only; macOS WKWebView still has no automation surface).

## Context

An Electrobun app can render with either its **default WebKit renderer** or an opt-in **CEF**
(Chromium Embedded Framework) renderer. How the app can be driven depends entirely on that
choice:

- The **WebKit renderer exposes no CDP** endpoint on any OS — there is no remote-debugging port
  to attach to, so it cannot be driven this way.
- **CEF serves CDP.** A spike confirmed on macOS that Chromedriver attaches via
  `goog:chromeOptions.debuggerAddress`, enumerates each window as a page target, and drives
  elements and deeplinks — the *same* attach model as `@wdio/electron-service`.
- On **Windows**, Electrobun's native **WebView2** renderer speaks CDP directly, so the same
  attach model applies without CEF.
- CEF/CDP availability is not uniform: macOS was validated; **Linux** ships with the CEF
  remote-debugging port commented out (an upstream gap); a W3C-WebDriver path via WebKitGTK
  (Linux) or a non-CDP route was considered and deferred.

## Decision

Drive Electrobun **over CDP**, attaching Chromedriver via `debuggerAddress`, mirroring the
Electron service so the attach model and the mock seam are shared.

CDP requires a CDP-speaking renderer, so the service requires one:

- **macOS** — the CEF renderer (`bundleCEF: true` + `renderer: 'cef'`); the default WebKit
  renderer is unsupported.
- **Windows** — the native WebView2 renderer (CDP), no CEF needed.

Ship macOS + Windows first; treat **Linux** (upstream-blocked) as a documented follow-up rather
than a launch blocker. Reject the non-CDP W3C-WebDriver path as premature.

## Consequences

- **Parallel/multiremote is constrained by CEF on macOS.** CEF is single-instance per cache
  root, and the remote-debugging port is fixed per bundle (read from `build.json`, never a
  launch arg). To run concurrent workers, each gets an APFS-cloned `.app` with its own pinned
  port, launched under a distinct `CFFIXED_USER_HOME`. That non-obvious machinery — cloning
  bundles, setting a Core Foundation env var — exists solely to defeat CEF's single-instance
  folding, and is why `nativeMode.ts` clones bundles. On Windows/WebView2 there is no such
  constraint, so multi-window/multiremote work there.
- **The default renderer is a footgun by design:** a user who forgets `bundleCEF`/`renderer`
  gets an app with no CDP endpoint. The service requires them explicitly and fails loudly.
- The remaining CEF-only, macOS-first gaps — per-window partition isolation, `open-url`
  routing, and Linux CDP — are tracked in the **#320** umbrella issue; several Electrobun E2E
  specs are pinned to single-instance until those land.
