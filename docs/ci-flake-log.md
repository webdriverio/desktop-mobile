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
| **F2** | Electron E2E teardown/hang | `Timeout reached, continuing the build`; session healthy through `deleteSession()`, dies at teardown | `E2E - Electron [Windows / Linux] - forge / builder / script` | Unfixed — needs a session-close/teardown investigation |
| **F3** | Docker distro transient | bridge `Error: Timeout`, mirror/network drop, or job log unavailable (`status 404`) | `Package - Tauri / Dioxus (Docker) [Void / Fedora]` | Ambient (distro mirror / network / bridge timing) |
| **F4** | Flutter iOS teardown exit-1 | test **passes** (`✓ should …`) then process exits `1` at teardown | `E2E - Flutter [iOS] - standard` | Unfixed — teardown exit-code |
| **F5** | Electrobun macOS CEF new-browser-info timeout | `cef/libcef/browser/browser_info_manager.cc:858 Timeout of new browser info response for frame …` (multi-view) | `E2E - Electrobun [macOS-ARM] - standard` | CEF isolation gaps (upstream); umbrella #320 |
| **F6** | Electron-forge packaging no-binary | forge packaging produces no binary (prune-related, flaky) | `Package / E2E - Electron [*] - forge` | Mitigated by prune-disable (#521); watch for recurrence |
| **F7** | Runner disk-full / teardown race | `ENOSPC`; Windows process-teardown races | any | Ambient runner capacity |
| **F8** | Dependabot red-on-first-run | dependency-bump PRs go red, clear on re-run | various | Ambient; re-run |
| **F9** | RN Android new-arch native-find | `✖ should find a native element via accessibility id` (`expect(...).toBe(true)`); UiAutomator2 accessibility-id lookup intermittently fails on the new architecture (other RN tests pass) | `E2E - React Native [Android] - standard (new-arch)` | Intermittent — **green on main**, can fail through a retry; investigate UiAutomator2 tree timing on new-arch |
| **F10** | Unit/integration suite hang (SIGINT/130) | tests pass, then `ELIFECYCLE Command failed with exit code 130` / `Failed: @wdio/<svc>#test:unit` — the suite is killed (step timeout), not a failing assertion; suspect an integration-test port/teardown hang | `Unit [*]` | Ambient; **green on main** (`fileParallelism: false` port isolation) |
| **F11** | RN iOS E2E intermittent spec fail | 1 of N specs intermittently fails (most pass); exact spec varies — signature TBD, refine on recurrence | `E2E - React Native [iOS] - standard (old / new-arch)` | Intermittent; RN iOS mobile-E2E timing (simulator / WDA / Appium) |

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
| 2026-08-02 | 30750927964 | #537 | E2E - Tauri [macOS-ARM] - standalone | F1 (embedded provider; app-unreachable `failed to send request … execute/async` ×4; crabnebula also red but allow-listed). Off main / **pre-#553** — the un-pumped embedded path, i.e. the exact flake #553 fixes |
| 2026-08-02 | 30750927964 | #537 | E2E - Tauri [macOS-ARM] - deeplink | F1 (embedded provider; app-unreachable `failed to send request … execute/async`; crabnebula allow-listed). Off main / **pre-#553** |
| 2026-08-02 | 30750927964 | #537 | Package - Dioxus (Docker) [Fedora] | F3 (bridge `Error: Timeout` — `should execute` + `should mock a bridge command`, ~12 m) |
| 2026-08-02 | 30730874052 (att. 1) | #528 | E2E - Tauri [macOS-ARM] - standalone | F1 (`Script execution timed out` ×3) — dependabot setup-node 6→7; a pure CI-infra bump drew all 4 top app-flake classes at once (F8 pattern). **Cleared on att. 2 retry** |
| 2026-08-02 | 30730874052 (att. 1) | #528 | E2E - Electron [Linux] - script | F2 (127 specs pass, then `Timeout reached` at teardown). **Cleared on att. 2 retry** |
| 2026-08-02 | 30730874052 (att. 1–2) | #528 | E2E - Flutter [iOS] - standard | F4 (9–13 ✓ then exit 1) — **recurred on retry** (both attempts) |
| 2026-08-02 | 30730874052 (att. 1–2) | #528 | E2E - React Native [Android] - standard (new-arch) | F9 (accessibility-id native find; 21 other specs pass) — **recurred on retry** (both attempts) |
| 2026-08-02 | 30723856572 | #519 | E2E - React Native [Android] - standard (new-arch) | F9 |
| 2026-08-02 | 30723856572 | #519 | E2E - React Native [iOS] - standard (old-arch) | F11 (1/6 specs flaked) |
| 2026-08-02 | 30723856572 | #519 | Unit [macOS-Intel] | F10 (green on main) |
| 2026-08-02 | 30723856572 | #519 | Package - Dioxus (Docker) [Fedora] | F3 |
| 2026-08-02 | 30722562323 (att. 1–2) | #558 | E2E - React Native [Android] - standard (new-arch) | F9 — recurred on job retry (both attempts failed; green on main) |
| 2026-08-02 | 30722562323 | #558 | E2E - Tauri [macOS-ARM] - standalone | F1 |
| 2026-08-02 | 30722562323 | #558 | E2E - Flutter [iOS] - standard | F4 |
| 2026-08-02 | 30722562323 | #558 | Package - Tauri (Docker) [Fedora] | F3 |
| 2026-08-02 | 30722561443 | #557 | E2E - Electron [Linux] - builder | F2 (Linux — teardown timeout after healthy session) |
| 2026-08-02 | 30722561443 (att. 1–5) | #557 | E2E - Tauri [macOS-ARM] - standalone | F1 att.1–4, **cleared on att. 5** → ~1-in-5 clear rate un-pumped (quantifies why F1 is #1) |
| 2026-08-02 | 30722561443 (att. 1–2) | #557 | E2E - Flutter [iOS] - standard | F4 — recurred on job retry |
| 2026-08-01 | 30710976372 (retry, att. 2) | #561 | E2E - Tauri [macOS-ARM] - deeplink | F1 — recurred on retry (embedded provider); F5 cleared |
| 2026-08-01 | 30710976372 | #561 | E2E - Tauri [macOS-ARM] - deeplink | F1 |
| 2026-08-01 | 30710976372 | #561 | E2E - Electrobun [macOS-ARM] - standard | F5 |
| 2026-08-01 | 30708074906 | #561 | Package - Tauri (Docker) [Void] | F3 |
| 2026-08-01 | 30708074906 | #561 | Package - Dioxus (Docker) [Void] | F3 |
| 2026-08-01 | 30708074906 | #561 | E2E - Electron [Windows] - forge | F2 |
| 2026-08-01 | 30708074906 | #561 | E2E - Tauri [macOS-ARM] - standalone | F1 |
| 2026-08-01 | 30701420535 | #560 | Package - Tauri [macOS-ARM] | F1 |
| 2026-08-01 | 30701283449 (att. 1–3) | #559 | E2E - Tauri [macOS-ARM] - deeplink | F1 on **all 3 attempts** — retry never cleared (both symptoms: `Script execution timed out` + app-unreachable `failed to send request`) |
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
