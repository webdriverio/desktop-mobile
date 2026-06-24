# 1. Driver-provider names describe the mechanism, not the vendor

Date: 2026-06-24

## Status

Accepted — retroactively documenting the decision made in [#275](https://github.com/webdriverio/desktop-mobile/pull/275) (2026-05-18).

## Context

The native-app testing services (`@wdio/electron-service`, `@wdio/tauri-service`, `@wdio/dioxus-service`, and the mobile services that follow) are converging on a near-identical API and feature surface, with shared plumbing extracted into `@wdio/native-core`. A consistent vocabulary across that family is a goal in its own right: an option a user learns for one service should mean the same thing in the next.

Every service that drives a WebView through WebDriver has to choose _how_ the WebDriver server is provided. Two mechanisms recur across the family:

- **In-app server** — WebDriver is served from inside the application under test. Tauri does this with `tauri-plugin-wdio-webdriver`; Dioxus with its embedded driver.
- **Separate driver process** — an external WebDriver binary is spawned alongside the app. Tauri uses `tauri-driver`; Dioxus uses `wdio-dioxus-driver` (which proxies to `msedgedriver` on Windows).

Tauri originally named these two `'embedded'` and `'official'`. `'official'` was _vendor_-framed: it meant the "official" upstream `tauri-driver`, as opposed to [CrabNebula](https://crabnebula.dev)'s fork. That framing does not generalise — Dioxus has no "official" driver — so it could not become the shared name for "use a separate driver process". CrabNebula's fork is a genuinely distinct third option, selected with `'crabnebula'`.

## Decision

Driver-provider values name the **mechanism**, not the vendor:

- **`'embedded'`** — the WebDriver server runs inside the app under test.
- **`'external'`** — a separate, external WebDriver process is used.

Consequences of that principle:

- **`'embedded'` is the default** for every service when `driverProvider` is unset.
- A vendor-specific driver that is not the generic external path keeps an explicit name. For Tauri that is **`'crabnebula'`**.
- Tauri's `'official'` becomes a deprecated alias for `'external'`. It is normalised to `'external'` with a one-time warning and is scheduled for removal in `@wdio/tauri-service` v2.

## Consequences

- One vocabulary across the service family: `embedded` vs `external` carries over from Tauri to Dioxus to future services, instead of each service inventing its own provider names.
- `'crabnebula'` remains a named exception. That is acceptable: it is a distinct commercial product, not "the generic external driver".
- Service docs and configs that still teach `'official'` are now stale and must migrate to `'external'`, citing this ADR. (`'official'` keeps working until v2, so the migration is non-breaking.)
- We accept a small loss of local clarity — `'official'` arguably read more naturally as "the canonical `tauri-driver`" — in exchange for family-wide consistency.
- The upstream project is still called "the official `tauri-driver`" in prose where that is the accurate description; only the configuration _value_ changes.
