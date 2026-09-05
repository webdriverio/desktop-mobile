# Draft upstream issue — Electrobun multi-instance support (NOT yet filed)

**Status:** drafted, **on hold** (maintainer decision to not post yet — revisit later).
**Target repo:** `blackboardsh/electrobun`.

## Why
`@wdio/electrobun-service` multiremote/parallel test execution needs to run multiple
concurrent instances of the same app. Today that requires a workaround (per-worker
`.app` clone + `build.json` port edit + distinct `CFFIXED_USER_HOME`). A launch-time
override would make it first-class.

## Existing adjacent issues (searched — none covers this exact need)
- **#445** Make CEF remote debugging opt-in — same `settings.remote_debugging_port` code path (security framing, not a runtime port override).
- **#380** macOS CEF persistent partitions / custom request-context cache paths — the cache-root machinery our isolation depends on.
- **#227** `requestSingleInstanceLock()` equivalent — the implicit single-instance folding is our root cause; that issue asks to *enforce* single-instance (inverse need).
- **#228** Batteries-included E2E tests (`electrobun test`) — overlapping automation goals (their built-in runner).
- (#438 already tracks the `dirname` bundler crash we hit; #424 is the no-TCP RPC transport.)

## Drafted issue

**Title:** Feature: opt-in multi-instance support (per-launch remote-debugging port + cache/user-data dir) for parallel automated testing

**Body:**

> **Context** — I'm building a WebdriverIO service (`@wdio/electrobun-service`) that drives CEF-rendered Electrobun apps over CDP (Chromedriver attaches via `goog:chromeOptions.debuggerAddress`). Single-instance automation works great on macOS — CEF serves `/json`, targets enumerate per webview, element-driving + deeplinks all work. 🎉
>
> **Blocker for parallel/multi-worker testing** — running two instances of the same app at once needs hacks, because:
> 1. **Single-instance per cache root** — `settings.root_cache_path` derives from `identifier`+`channel` (`buildAppDataPath(...)`), so a 2nd launch of the same bundle folds into the 1st (`"Opening in existing browser session."`) with no 2nd CEF/debug endpoint.
> 2. **Remote-debugging port is build-time only** — read from the bundle's `Contents/Resources/build.json` `chromiumFlags["remote-debugging-port"]`; `main.js` doesn't forward process argv to CEF, so a `--remote-debugging-port` launch arg is ignored.
>
> **Current workaround (works, heavy)** — per worker: `cp -c` the `.app`, rewrite the copy's `build.json` port, launch with a distinct `CFFIXED_USER_HOME` (redirects the cache root via `CFCopyHomeDirectoryURL`). macOS-only confidence; N bundle copies; relies on undocumented env behavior.
>
> **Request** — a documented way to run concurrent instances of one app for automated testing, ideally launch-time overrides: `ELECTROBUN_REMOTE_DEBUGGING_PORT=<n>` and `ELECTROBUN_USER_DATA_DIR=<path>` (or an "allow multiple instances" mode). Also benefits DevTools/MCP and any external harness (WDIO, Playwright).
>
> **Related:** #445 (remote-debugging opt-in — same code path), #380 (custom CEF cache paths), #227 (single-instance lock — inverse need / root cause), #228 (batteries-included E2E). Happy to test / contribute a PR.
