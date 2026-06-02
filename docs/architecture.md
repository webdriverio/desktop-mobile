# Architecture Overview

This document describes the architecture of the WebdriverIO Desktop & Mobile monorepo.

## High-Level Architecture

```
+---------------------------------------------------------------------+
|                        WebdriverIO Test Runner                      |
+---------------------------------------------------------------------+
                                 |
          +-----------+----------+-----------+
          |           |                      |
          v           v                      v
+------------------+ +------------------+ +------------------+
| @wdio/electron-  | | @wdio/tauri-     | | @wdio/dioxus-    |
| service          | | service          | | service          |
| (Electron Tests) | | (Tauri Tests)    | | (Dioxus Tests)   |
+------------------+ +------------------+ +------------------+
         |                    |                    |
         v                    v                    v
+------------------+ +------------------+ +------------------+
| @wdio/electron-  | | @wdio/tauri-     | | wdio-dioxus-     |
| cdp-bridge       | | plugin           | | bridge           |
| (Chrome DevTools)| | (Execute, Mock,  | | (Execute, Mock,  |
|                  | |  Logs)           | |  Logs, Embedded  |
+------------------+ +------------------+  Driver)          |
         |                    |            +------------------+
         v           +--------+--------+           |
+------------------+ |        |        |           v
|   Chromedriver   | v        v        v  +------------------+
|   (WebDriver)    | Embedded Official CN | wdio-dioxus-     |
+------------------+ (in-app) (tauri- (paid) embedded-driver |
         |           server) driver)   |  (in-process       |
         v                    |        |   WebDriver server) |
+------------------+          +--------+  +------------------+
| Electron App     |                v              |
+------------------+     +------------------+      |
                          |   Tauri App      |      v
                          +------------------+ +------------------+
                                               |   Dioxus App     |
                                               +------------------+
```

## Package Responsibilities

### Service Packages

| Package | Responsibility |
|---------|---------------|
| `@wdio/electron-service` | WebdriverIO service for Electron apps |
| `@wdio/tauri-service` | WebdriverIO service for Tauri apps |
| `@wdio/dioxus-service` | WebdriverIO service for Dioxus desktop apps |
| `@wdio/electrobun-service` | WebdriverIO service for Electrobun desktop apps (CDP-attach; macOS-only in 0.x) |

### Bridge/Plugin Packages

| Package | Responsibility |
|---------|---------------|
| `@wdio/electron-cdp-bridge` | Chrome DevTools Protocol bridge for main process access |
| `@wdio/tauri-plugin` | Tauri v2 plugin for backend command invocation |
| `wdio-dioxus-bridge` | Dioxus bridge crate — IPC channel, mock dispatch, log forwarding, embedded driver wiring |
| `wdio-dioxus-embedded-driver` | In-process WebDriver HTTP server for Dioxus |
| `wdio-dioxus-driver` | External WebDriver proxy (fork of tauri-driver); Windows `'external'` provider only |

### Shared Packages

| Package | Responsibility |
|---------|---------------|
| `@wdio/native-utils` | Cross-platform utilities (logging, binary detection) |
| `@wdio/native-types` | Shared TypeScript type definitions |
| `@wdio/native-spy` | Spy utilities for mocking |
| `@wdio/bundler` | Build tooling for package compilation |

## Service Architecture Pattern

All WDIO services follow a consistent architecture:

### Launcher (`launcher.ts`)

Runs in the main process (no `browser` access). Responsible for:
- Driver discovery/installation
- Process spawning (ports, args, env)
- Startup detection and health checks
- Graceful shutdown (SIGTERM → SIGKILL)
- Per-worker instance management

**Hooks:** `onPrepare`, `onWorkerStart`, `onWorkerEnd`, `onComplete`

### Service (`service.ts`)

Runs in the worker process (receives `browser` via `before` hook). Responsible for:
- API injection (`browser.tauri.*`, `browser.electron.*`, `browser.dioxus.*`, `browser.electrobun.*`)
- Mock lifecycle management
- Log forwarding setup
- Plugin initialization

**Hooks:** `before`, `beforeTest`, `beforeCommand`, `after`, `afterSession`

## Log Forwarding Architecture

```
+---------------------------------------------------------------------+
|                      Application Under Test                         |
+---------------------------------------------------------------------+
|  Backend Logs (Rust/Node)  |  Frontend Logs (Browser)               |
+----------------+------------+----------------+----------------------+
                 |                           |
                 v                           v
+-------------------------+  +-------------------------------------+
|       stdout/stderr     |  |             Console API             |
|       (driver process)  |  |           (browser context)         |
+-------------------------+  +-------------------------------------+
                 |                           |
                 v                           v
+-------------------------+  +-------------------------------------+
|       Log Parser        |  |          Console Wrapper            |
|       (parseLogLine)    |  |          (intercept logs)           |
+-------------------------+  +-------------------------------------+
                 |                           |
                 +------------+--------------+
                              v
                  +-------------------------+
                  |      Log Forwarder      |
                  |      (forwardLog)       |
                  +------------+------------+
                               |
                               v
                  +-------------------------+
                  |      WDIO Logger        |
                  |  (per-instance output)  |
                  +-------------------------+
```

## Electron-Specific Architecture

### CDP Bridge

```
+---------------------------------------------------------------------+
|                    Electron Application                             |
+---------------------------------------------------------------------+
|  Main Process              |        Renderer Process                |
|  (Node.js)                 |        (Chromium)                      |
+----------------+-----------+----------------+-----------------------+
                 |                          |
                 v                          v
+-------------------------+    +------------------------------------+
|     CDP Bridge          |    |          Chromedriver              |
|     (Puppeteer)         |    |          (WebDriver)               |
+-------------------------+    +------------------------------------+
                 |                          |
                 |      Main Process Access |
                 |<-------------------------|
                 |                          |
                 v                          v
+---------------------------------------------------------------------+
|                   @wdio/electron-service                            |
+---------------------------------------------------------------------+
```

## Tauri-Specific Architecture

### Driver Providers

```
+---------------------------------------------------------------------+
|                   @wdio/tauri-service                               |
+-------------------------+-------------------------------------------+
                           |
           +---------------+---------------+
           v               v               v
+-----------------+ +---------------+ +---------------+
|   Embedded      | |   Official    | |  CrabNebula   |
|   (default)     | |               | |  (paid)       |
+-----------------+ +---------------+ +---------------+
| HTTP server     | | tauri-driver  | | test-runner   |
| inside app via  | | → native      | | -backend      |
| tauri-plugin-   | |   driver      | |               |
| wdio-webdriver  | | (WebKitGTK,   | |               |
|                 | |  msedgedriver)| |               |
+-----------------+ +---------------+ +---------------+
```

### Plugin Communication

```
+---------------------------------------------------------------------+
|                    Tauri Application                                |
+---------------------------------------------------------------------+
|  Backend (Rust)            |        Frontend (WebView)              |
|  tauri-plugin-wdio         |        @wdio/tauri-plugin              |
|  (execute, log commands)   |        (mock interception,             |
|                            |         console forwarding)            |
+----------------+-----------+----------------+-----------------------+
                 |      Tauri invoke IPC      |
                 |<---------------------------|
                 |                            |
                 v                            v
+---------------------------------------------------------------------+
|                   @wdio/tauri-service                               |
|        browser.tauri.execute(), mock(), triggerDeeplink()           |
+---------------------------------------------------------------------+
```

## Dioxus-Specific Architecture

### Driver Providers

```
+---------------------------------------------------------------------+
|                   @wdio/dioxus-service                              |
+-----------------------------+---------------------------------------+
                              |
           +------------------+------------------+
           v                                     v
+--------------------+              +------------------------+
|   Embedded         |              |   External             |
|   (default,        |              |   (Windows only, v1)   |
|    all platforms)  |              |                        |
+--------------------+              +------------------------+
| wdio-dioxus-       |              | wdio-dioxus-driver     |
| embedded-driver    |              | → msedgedriver.exe     |
| HTTP server inside |              | (WebView2 automation)  |
| app (wired via     |              |                        |
| wdio-dioxus-bridge)|              |                        |
+--------------------+              +------------------------+
```

### Bridge Communication

```
+---------------------------------------------------------------------+
|                    Dioxus Application (debug build)                 |
+---------------------------------------------------------------------+
|  Backend (Rust)                |     Frontend (Wry WebView)         |
|  Rust `log` crate output       |     guest-js bundle                |
|  captured by bridge            |     (mock interception,            |
|                                |      console forwarding)           |
+-------------+------------------+----------------+-------------------+
              |    wdio:// custom protocol        |
              |<----------------------------------|
              |                                  |
              v                                  v
+---------------------------------------------------------------------+
|               wdio-dioxus-bridge (install(config))                  |
|  - embedded WebDriver server on DIOXUS_WEBVIEW_AUTOMATION_PORT      |
|  - wdio:// IPC channel                                              |
|  - log forwarder                                                     |
+---------------------------------------------------------------------+
              |
              v
+---------------------------------------------------------------------+
|                   @wdio/dioxus-service                              |
|        browser.dioxus.execute(), mock(), triggerDeeplink()          |
+---------------------------------------------------------------------+
```

The key architectural difference from Tauri is that Dioxus has no plugin-trait system. The bridge integrates at the `dioxus::desktop::Config` level (via the `install()` function) rather than through a registered plugin chain. The IPC channel is a Wry custom protocol (`wdio://`) rather than Tauri's IPC machinery.
