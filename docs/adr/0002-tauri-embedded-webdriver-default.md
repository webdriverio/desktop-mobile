# 2. Tauri drives its WebView through an in-app embedded WebDriver server by default

Date: 2026-08-03

## Status

Accepted — retroactively documenting a decision made across the Tauri service's early
development. The embedded provider landed in [#166](https://github.com/webdriverio/desktop-mobile/pull/166)
(the plugin is `tauri-plugin-wdio-webdriver`); the CrabNebula provider in
[#171](https://github.com/webdriverio/desktop-mobile/pull/171). Builds on
[ADR-0001](./0001-driver-provider-naming.md), which named the resulting providers.

## Context

A Tauri app renders in the platform WebView — WKWebView on macOS, WebView2 on Windows,
WebKitGTK on Linux. Driving it over WebDriver needs a WebDriver server for that WebView, and
there were two off-the-shelf options, each with a hard limitation:

- **The upstream `tauri-driver`** spawns an external platform driver (`msedgedriver` on
  Windows, `webkit2gtk-driver` on Linux). It has **no macOS path** — WKWebView exposes no
  automation driver. Early research concluded macOS was impossible and the service shipped
  Windows/Linux-only, with the launcher explicitly throwing on `darwin`.
- **CrabNebula's proprietary fork** *does* support macOS, but only by taking a paid, closed
  dependency: a subscription + `CN_API_KEY`, a separate `test-runner-backend` process on
  macOS, a `tauri-plugin-automation` conditionally compiled into the app, and an OSS-license
  request to run it in CI.

Leaving macOS unsupported, or making macOS depend on a subscription product, both undercut the
goal of a free, first-class, cross-platform testing service.

## Decision

Build an **open, in-app WebDriver server** (`tauri-plugin-wdio-webdriver`) that runs inside the
app under test, and make it the default — `driverProvider: 'embedded'`. It serves WebDriver on
all three platforms, macOS included, with no external driver binary and no subscription.

The other two mechanisms remain, as explicit opt-ins on the **same service** rather than
separate packages:

- **`'external'`** — the upstream `tauri-driver`, for users who prefer it on Windows/Linux.
- **`'crabnebula'`** — CrabNebula's fork, a named exception for teams that want its product.

Integrating CrabNebula as a provider value (not a separate `@wdio/crabnebula-service`, and not
a general plugin system) was a deliberate build-vs-buy-vs-fragment choice: one service, one
option to learn, platform differences hidden behind the `driverProvider` seam.

## Consequences

- **macOS is a first-class, free path** — the embedded server, not a paid dependency, is what
  makes it work. `'embedded'` is the default precisely so this is what users get out of the box.
- **The embedded server is immune to external-driver failure modes.** When a CI runner's
  Edge/WebView2 bumped to 150 and broke the elevated-host CDP path for the external and
  CrabNebula routes on Windows, the embedded driver stayed green.
- **We own a WebDriver server implementation** — a Tauri plugin with its own release cadence
  (see also the standalone `tauri-plugin-wdio-webdriver` crate). That maintenance cost is the
  price of not depending on a third party for the default path.
- **The `embedded`/`external` vocabulary generalises** to the rest of the service family; see
  ADR-0001, which standardised the mechanism-not-vendor names and deprecated Tauri's original
  `'official'` alias.
- The early "macOS unsupported" documentation and the Windows/Linux-only framing are superseded.
