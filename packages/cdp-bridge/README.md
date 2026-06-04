# @wdio/cdp-bridge

Shared Chrome DevTools Protocol (CDP) bridge for WebdriverIO native-app services. Provides the low-level pieces every CDP-attach service needs, so each service composes rather than re-implements:

- **`Connection`** — a single CDP WebSocket connection to one target (request/response correlation, timeouts, observation-only — never issues `Page.navigate`).
- **`DevTool`** — HTTP target discovery (`/json`, `/json/version`) with port-wait/retry.
- **`CdpBridge`** — single-target client: discover → pick a target (`selectTarget`, default first) → connect. Supports an `origin`/`headers` option for endpoints that enforce a WebSocket Origin check (e.g. React Native's Fusebox inspector-proxy).
- **`MultiTargetCdpBridge`** — multi-target client: one `Connection` per target, with `switchTarget`/`listWindows`/`refresh`/`sendTo`, backed by a `TargetRegistry`. Target classification is **injected** (`classifyTarget`) so renderer-specific schemes stay in the consuming service.

Consumers:

- `@wdio/electrobun-service` — `MultiTargetCdpBridge` (CEF, one target per window; supplies the CEF classifier).
- `@wdio/react-native-service` — `CdpBridge` (single Hermes target via Metro's inspector-proxy; supplies a Hermes `selectTarget` + `origin`).
- `@wdio/electron-service` — migrating to `CdpBridge` (single-target).

Not a public/user-facing package — it's internal infrastructure for the service family.
