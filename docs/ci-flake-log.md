# CI Flake Log

A running record of **transient / environmental CI failures** — the ones that pass on
re-run and aren't caused by the PR under test — plus the **silent-reliability traps** that
make CI lie (spurious reds from poisoned caches, false greens from truncated scripts). The
goal is to categorise them, track how often each class recurs, and drive the classes down
over time to raise the **first-time pass rate** of CI.

## How to use

When a CI run goes red (or suspiciously green) on something unrelated to the change:

1. Match each failure to a class below (or add a new one: `F#` transient red, `E#`
   deterministic — retry won't help, `C#` cache/silent-pass trap).
2. Append a row to the **Occurrence log** (newest first): date, run id, PR, job, class.
3. When a class becomes fixable, link the tracking issue/PR and mark it.

## A. Transient reds (retry usually clears)

| ID | Class | Signature | Jobs typically hit | Status / fix |
|----|-------|-----------|--------------------|--------------|
| **F1** | Tauri macOS DirectEval flake (#540) | `Error: Script execution timed out` (~26 s gap between `runJavaScript` calls on the idle headless run loop); earlier variant `A JavaScript exception occurred (code 4): Completion handler … no longer reachable` | `E2E - Tauri [macOS-ARM] - standalone / deeplink`, `Package - Tauri [macOS-ARM]` | code-4 fixed in #549; residual idle-stall fix in flight PR #553 (50 ms `NSTimer` run-loop pump). Track: #540 |
| **F2** | Electron Windows E2E teardown/hang | `Timeout reached, continuing the build`; session healthy through `deleteSession()`, dies at teardown | `E2E - Electron [Windows] - forge / builder / script` | Unfixed — needs a session-close/teardown investigation |
| **F3** | Docker distro transient | bridge `Error: Timeout`, mirror/network drop, or job log unavailable (`status 404`) | `Package - Tauri / Dioxus (Docker) [Void / Fedora]` | Ambient (distro mirror / network / bridge timing) |
| **F4** | Flutter iOS teardown exit-1 | test **passes** (`✓ should …`) then process exits `1` at teardown | `E2E - Flutter [iOS] - standard` | Unfixed — teardown exit-code |
| **F5** | Electrobun macOS CEF new-browser-info timeout | `cef/libcef/browser/browser_info_manager.cc:858 Timeout of new browser info response for frame …` (multi-view) | `E2E - Electrobun [macOS-ARM] - standard` | CEF isolation gaps (upstream); umbrella #320 |
| **F6** | Electron-forge packaging no-binary | forge packaging produces no binary (prune-related, flaky) | `Package / E2E - Electron [*] - forge` | Mitigated by prune-disable (#521); watch for recurrence |
| **F7** | Runner disk-full / teardown race | `ENOSPC`; Windows process-teardown races | any | Ambient runner capacity |
| **F8** | Dependabot red-on-first-run | dependency-bump PRs go red, clear on re-run | various | Ambient; re-run |

**Allow-listed (expected red, not counted against pass rate):**
- **WebView2 150 elevated-host regression (#542 / WebView2Feedback #5645)** — runner Edge
  149→150 broke Windows CDP E2E for **official Tauri + Electrobun** providers (session
  timeout; by-design elevated-host hardening). Our **embedded** Tauri driver is immune.
  `E2E - Electrobun [Windows]` is `continue-on-error`; stopgap = fixed-version-149 pin.

## B. Deterministic failures — retry does NOT help; apply the fix

Retrying these only burns CI time: they fail the same way until the documented fix lands.
Not the PR's fault, but not flakes either.

| ID | Issue | Signature | Fix (do not retry) |
|----|-------|-----------|------------|
| **E1** | Electron Windows vite 8 / Rolldown build (vite#10802) | `RolldownError: … "fileName" … neither absolute nor relative paths … src/renderer/index.html` from `[plugin vite:build-html]` | **Fixed** PR #561 — canonicalise the package-test temp base on Windows (`realpathSync.native(tmpdir())`) so `config.root` matches vite's realpath'd input |
| **E2** | Cargo.lock drift | uncommitted lock → CI re-resolves → `time 0.3.48` broke `cookie` (E0119) | **Fixed** #391 — commit locks + pin `time 0.3.47`; new crates must commit their lock |
| **E3** | Docker `npm install` arborist crash | `npm install` dies (`node.target` null) over the pnpm symlink farm; recurs for every new docker fixture | `rm -rf node_modules package-lock.json` before install (#385) — a re-run just fails the same way |
| **E4** | Dioxus Docker bridge "timeout" | bridge command `Error: Timeout` that is actually a **missing guest-JS bundle** (not GL/network) | build/copy the guest-JS bundle into the fixture — a re-run just fails the same way |

## C. Cache-correctness & silent-pass traps (CI lies — spurious red or false green)

| ID | Trap | Signature | Resolution |
|----|------|-----------|------------|
| **C1** | Poisoned Turbo **remote** cache | `bundler injectDependencyPlugin`-undefined build failure restored from a bad remote cache entry | **Fixed** #505 — `shx rm -rf dist` before rollup; residual tracked #509 |
| **C2** | Turbo stale cache via `tsconfig extends` | shared `tsconfig.base` change served stale build caches (Turbo ignores `extends`) | **Fixed** #519 — add to `globalDependencies`; beware `$TURBO_EXTENDS$` with root `<pkg>#build` overrides |
| **C3** | Turbo output-path trap | moved a build artifact → **full cache hit restores nothing** (job green, output missing) | Update `turbo.json` `outputs` + consumer paths together (#304) |
| **C4** | Inline docker script truncation (**false green**) | unescaped `"` in `bash -c "…"` truncates the script → exits 0 running nothing; tell: same-second pass, 0-byte logs | Tauri `test.sh` still affected — fix pending |
| **C5** | android-emulator-runner line-by-line | `script:` runs each line as a separate `sh -c`; shell vars don't persist | rc-capture logic must be one line (#430) |

## Occurrence log (newest first)

| Date | Run | PR | Job | Class |
|------|-----|----|----|-------|
| 2026-08-01 | 30710976372 (retry, att. 2) | #561 | E2E - Tauri [macOS-ARM] - deeplink | F1 — recurred on retry (embedded provider); F5 cleared |
| 2026-08-01 | 30710976372 | #561 | E2E - Tauri [macOS-ARM] - deeplink | F1 |
| 2026-08-01 | 30710976372 | #561 | E2E - Electrobun [macOS-ARM] - standard | F5 |
| 2026-08-01 | 30708074906 | #561 | Package - Tauri (Docker) [Void] | F3 |
| 2026-08-01 | 30708074906 | #561 | Package - Dioxus (Docker) [Void] | F3 |
| 2026-08-01 | 30708074906 | #561 | E2E - Electron [Windows] - forge | F2 |
| 2026-08-01 | 30708074906 | #561 | E2E - Tauri [macOS-ARM] - standalone | F1 |
| 2026-08-01 | 30700125548 | #558 | E2E - Electron [Windows] - forge | F2 |
| 2026-08-01 | 30699263358 | #557 | Package - Dioxus (Docker) [Fedora] | F3 |
| 2026-08-01 | 30699263358 | #557 | E2E - Flutter [iOS] - standard | F4 |
| 2026-08-01 | 30699263358 | #557 | E2E - Tauri [macOS-ARM] - deeplink | F1 |
| 2026-08-01 | 30700419259 | #556 | E2E - Tauri [macOS-ARM] - standalone / deeplink | F1 |

## Priority to raise first-time pass rate

Ranked by recurrence × fixability observed so far:

1. **F1 (Tauri macOS #540)** — most frequent; fix already in flight (#553). Land it.
2. **F2 (Electron Windows E2E teardown)** — recurs on every full-matrix run; no owner. Best next target.
3. **C4 (inline docker false green)** — silent, actively hiding failures; cheap to fix.
4. **F5 / F3 / F4** — lower-frequency transients, partly upstream (CEF, Docker distros).
5. **E3 / E4 (deterministic)** — not flakes; fix when a docker fixture next trips them, don't retry.
