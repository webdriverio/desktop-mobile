# Electrobun Service Research — Phase 0 Spike Findings

**Date:** May 28, 2026
**Status:** SPIKE COMPLETE — macOS leg validated
**Goal:** Confirm a WebdriverIO CDP-attach service can drive a CEF-rendered Electrobun app, and pin down the architecture before the MVP PR.

---

## 🎯 Executive Summary

**RECOMMENDATION: ✅ GO (macOS validated) — CDP-attach + Chromedriver `debuggerAddress` is viable.**

A throwaway CEF Electrobun app was built and driven end-to-end on macOS (darwin/arm64). Every load-bearing question passed: CEF serves CDP, Chromedriver attaches via `debuggerAddress` and drives elements, multiple windows enumerate as separate page targets, attach is observation-only (no `Page.navigate`), and macOS deeplinks reach the handler. The model mirrors `@wdio/electron-service`.

The two biggest items for the MVP PR are **per-worker process isolation** (CEF is single-instance per `--user-data-dir`) and **Linux/Windows CDP availability** (only macOS validated here; Linux likely needs an upstream fix).

### Environment validated
- macOS darwin/arm64 only. Bun 1.3.13, Node v24.14.0.
- Electrobun source `1.18.4-beta.3` (npm `latest` lags at `1.18.1`); CEF/Chromium `147.0.10 / 147.0.7727.118`.
- Chromedriver `147.0.7727.117` (Chrome for Testing, mac-arm64) — matching on **major 147** is what matters.

---

## 📊 The six questions

### 1. Per-OS CEF availability
- **macOS: ✅ validated.** CEF serves CDP. `nativeWrapper.mm:~5847` scans `FindAvailableRemoteDebugPort(9222,9232)` then sets `settings.remote_debugging_port`.
- **Linux: ⚠️ likely OFF.** `linux/nativeWrapper.cpp:~2386` has `settings.remote_debugging_port` **commented out** → a stock Linux CEF build may serve no `/json`. Validate in CI; likely needs an upstream patch or proof that `chromiumFlags` alone enables it.
- **Windows: ❓ untested.**
- The default **WebKit** renderer exposes no CDP on any OS — CEF-only. The service must require `bundleCEF: true` + `renderer: 'cef'`.

### 2. Chromedriver-attach viability — ✅ YES
Chromedriver `147.0.7727.117` opened a session with `goog:chromeOptions.debuggerAddress: localhost:9333`, reported `browserVersion 147.0.7727.118`, returned **both windows as handles**, found `#increment-button`/`#counter`, clicked 3× (counter 0→3), and read `#app-title`. Same attach shape as `@wdio/electron-service`. Exact-patch chromedriver isn't published; **match on major 147**.

### 3. Port control — ✅ PINNABLE (inverts the going-in assumption)
`mac.chromiumFlags: { "remote-debugging-port": "9333" }` pinned the port to **9333**, *overriding* the 9222–9232 auto-scan (9222 was free but unused). Mechanism: the wrapper both sets `CefSettings.remote_debugging_port` from the scan **and** appends `--remote-debugging-port` to the command line — **the command-line switch wins**. So the service CAN dictate the port, rather than only discover it.
- ⚠️ **Concurrency caveat:** a 2nd launch of the same bundle logged `Opening in existing browser session.` and spawned **no second CEF** — CEF is **single-instance per `--user-data-dir`**. Parallel WDIO workers each need a **distinct `--user-data-dir` + distinct pinned port**.

### 4. Target enumeration shape
`/json` returned **2 targets, both `type:"page"`** — one per window (`views://mainview/index.html`, `views://secondview/index.html`). **No separate shell target**; each window/view is one content page. Discriminate by URL path under the custom `views://` scheme + title; in-page via `window.__electrobunWebviewId`/`WindowId` (main 1/1, second 2/2). Target IDs were **stable** across re-enumeration and equal to the handles Chromedriver returned. `Runtime.enable`/`evaluate`/`callFunctionOn` round-tripped **without `Page.navigate`**.

### 5. In-webview IPC/RPC surface
Every CEF webview exposes: `__electrobun` (`receiveMessageFromBun`, `receiveInternalMessageFromBun`), `__electrobunBunBridge`, `__electrobunInternalBridge`, `__electrobunEventBridge`, `__electrobunSendToHost` (fn), `__electrobun_encrypt`/`_decrypt` (fns), `__electrobunWebviewId`, `__electrobunWindowId`, `__electrobunRpcSocketPort` (50000), `__electrobunSecretKeyBytes`.
- The **Bun backend bus IS reachable** from the webview via the host RPC WebSocket (`ws://localhost:<__electrobunRpcSocketPort>/socket?webviewId=<id>`), but payloads are **AES-encrypted** with the secret key.
- **Tractable mock seam:** wrap `window.__electrobun.*` / `__electrobunSendToHost` before app code runs, via CDP `Page.addScriptToEvaluateOnNewDocument`. This surface differs materially from Electron's `ipcRenderer`/`contextBridge`.

### 6. Deeplink — ✅ YES (macOS, warm start)
`open electrobun-playground://test/path?foo=bar` reached the handler with the full URL. Scheme registered in `Info.plist` `CFBundleURLTypes`. Handler API: `app.on("open-url", …)` (**named export** `import { app } from "electrobun/bun"`) or `Electrobun.events.on("open-url", …)`. Only warm-start exercised; cold-start + Linux/Windows untested.

---

## 🚧 Blockers / must-handle for the MVP PR

1. **Concurrent instances** *(biggest architectural item)* — one bundle = one CEF session per `--user-data-dir`; a 2nd launch folds into the 1st. Parallel/multiremote workers need a **per-worker `--user-data-dir` + distinct pinned `--remote-debugging-port`**. Confirm the port/user-data-dir can be passed at **launch time** (CLI/env), not only via build-time `electrobun.config.ts`.
2. **Linux CDP off by default** (`remote_debugging_port` commented out) and **Windows unverified** — validate both in CI; Linux likely needs an upstream patch or a confirmed `chromiumFlags` path. Until then, macOS + Windows lead, Linux is a documented follow-up.
3. **`1.18.4-beta.3` ships two defects** the spike had to patch around (pin a known-good release; don't rely on `file:` source linking):
   - **B1:** dev `dist/` fallback only copies `main.js`, then `ENOENT dist/preload-full.js`.
   - **B2 (hard crash):** the bundler renames `import {join}`→`join5` for the WGPU chunk but drops `dirname`, so the Bun worker dies on boot with `ReferenceError: dirname is not defined` in `findWgpuLibraryPath`.
4. **Version skew** — npm `electrobun` 1.18.1 lags source/CEF 1.18.4-beta.3 / Chromium 147. Pin compatible Electrobun + chromedriver (major 147) explicitly.

## Launch-time control mechanism (PR2 source investigation)

Followed up on blocker 1 by reading the macOS native wrapper + `chromium_flags.h`:

- **Port — per-bundle, NOT a launch arg ⚠️ (source-inference corrected by empirical test).** The
  source path suggested `CefMainArgs(argc, argv)` (`nativeWrapper.mm:5832`) would let a launch-time
  `--remote-debugging-port` reach CEF — **but the shipped launcher disproves this.** The built
  `Contents/Resources/main.js` only forwards identifier/name/channel into the native run-main-thread
  entry; it never propagates process argv to CEF, and the port is read **exclusively** from
  `Contents/Resources/build.json` `chromiumFlags.remote-debugging-port` by `libNativeWrapper.dylib`
  at runtime (pinned 9333 + `--remote-debugging-port=9351` arg → CEF stayed on 9333; emptied config +
  arg → fell back to 9222). **So the port is fixed per bundle.** To vary it per worker, give each
  worker its own bundle copy (`cp -c`, APFS clone ≈ instant) with the port written into that copy's
  `build.json` (no full rebuild — the dylib re-reads `build.json` at runtime).
- **Cache / user-data isolation — `CFFIXED_USER_HOME` works ✅.** `settings.root_cache_path` =
  `buildAppDataPath(appSupport, identifier, channel, "CEF")` (`nativeWrapper.mm:5895–5908`), and
  `NSApplicationSupportDirectory` resolves via `CFCopyHomeDirectoryURL()` which honors
  **`CFFIXED_USER_HOME`**. Setting a distinct `CFFIXED_USER_HOME` per launch redirects each instance's
  CEF cache to its own root (verified: real home stayed clean; `HOME` not required, harmless to also
  set). This defeats CEF's single-instance-per-cache-root folding.

**Implication for multiremote / per-worker parallelism — ACHIEVABLE on macOS, no upstream change.**
Empirically confirmed: with per-instance `CFFIXED_USER_HOME` + per-instance `build.json` port, two
concurrent same-app instances both served CDP and were independently driveable (`Runtime.evaluate`
`1+1`→`2` on both ports, 2 process trees, 2 distinct caches, zero "Opening in existing browser
session"). **Mechanism the launcher must implement:** per worker → clone the `.app` (APFS `cp -c`),
write a distinct allocated `remote-debugging-port` into the clone's `Contents/Resources/build.json`,
launch with a distinct `CFFIXED_USER_HOME` temp dir. Single-instance (MVP) is the same path with N=1.
(Linux/Windows isolation still unverified — CI.)

### CFFIXED_USER_HOME workaround test (decisive evidence)
- Control (no home override): only 1 of 2 ports served CDP; instance B logged `Opening in existing
  browser session`; both resolved the same `~/Library/Application Support/<id>/dev/CEF`.
- Workaround (`CFFIXED_USER_HOME=/tmp/eb-home-N` per instance): both `:9361/json/version` and
  `:9362/json/version` live simultaneously, 2 CEF trees, caches under each redirected home, both WS-
  driveable. `CFFIXED_USER_HOME` alone is sufficient.
- Launch-arg port override: **does not work** (see above) → per-worker bundle copy required.
- Caveats: benign `Cannot create profile at path .../partitions/default` + transient
  `blink.mojom.Widget` warnings appear in ALL runs (incl. baseline), not caused by the redirect;
  bundled resources render fine under a redirected home; startup time unaffected.

## API gotcha worth recording
`app` is a **named export** (`import { app } from "electrobun/bun"`), not on the default export. `Electrobun.app.on(...)` throws; the default export only carries `.events`.

---

*Spike artifacts (throwaway, gitignored): `spike/electrobun-spike/` — `app/`, `scripts/`, `chromedriver/`, `app-stdout.log`. All processes/ports were cleaned up.*
