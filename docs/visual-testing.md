# Visual Regression Testing

WDIO's service architecture lets framework services and ecosystem services compose freely. Adding **[`@wdio/visual-service`](https://webdriver.io/docs/visual-testing/)** for visual regression testing (VRT) alongside any of our framework services is supported by default — no special integration needed. This guide covers only what's *framework-specific* on top of the [upstream guide](https://webdriver.io/docs/visual-testing/): output-path conventions, framework-specific known issues, and the mock-API handoff for native UI surfaces.

A complete working setup for every currently supported framework — see the [README](../README.md) for the list — lives in the [wdio-desktop-mobile-example](https://github.com/goosewobbler/wdio-desktop-mobile-example) repo, each package with `wdio.visual.conf.ts` + `test/visual/visual.spec.ts`.

## Quick start

### 1. Install the visual service

```bash
npm install --save-dev @wdio/visual-service
```

### 2. Add it to your WDIO config

```ts
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Services } from '@wdio/types';

const __dirname = dirname(fileURLToPath(import.meta.url));

const visualService: Services.ServiceEntry = [
  'visual',
  {
    // For Tauri, append the driver provider: ..., process.platform, process.arch, driverProvider, 'baseline'
    baselineFolder: join(__dirname, '__visual__', process.platform, process.arch, 'baseline'),
    screenshotPath: join(__dirname, '__visual__', process.platform, process.arch, 'actual'),
    formatImageName: '{tag}-{width}x{height}',
    autoSaveBaseline: !process.env.CI,
  },
];

// services: [yourExistingServiceEntry, visualService]
```

Tauri additionally appends `driverProvider` to the path because its three providers capture differently (see [Tauri provider notes](#tauri-provider-notes)).

### 3. Write a spec

```ts
import { browser, expect } from '@wdio/globals';

const MAX_MISMATCH_PCT = 1; // see "Cross-platform considerations"

it('matches baseline', async () => {
  await browser.execute(async () => { await document.fonts.ready; });
  expect(await browser.checkScreen('home')).toBeLessThanOrEqual(MAX_MISMATCH_PCT);
});
```

Run twice — first writes the baseline (because `autoSaveBaseline` is `true` locally), second validates the match. Then introduce a UI change and re-run to confirm the diff is surfaced.

## Output paths

Same app, different OS → different font rendering, different anti-aliasing. Per-OS baselines are not optional. The recommended layout — `__visual__/<platform>/<arch>/[<framework-segment>/]baseline|actual` — is the cheapest sane convention. Most framework services need only `<platform>/<arch>`; Tauri additionally requires a `<provider>` segment (see [Tauri provider notes](#tauri-provider-notes)).

Add `__visual__` to `.gitignore` if you want CI to manage baselines per-runner; check it in if you want explicit baseline review on PRs.

## Cross-platform considerations

### `autoSaveBaseline` for CI

`!process.env.CI` writes missing baselines locally (convenient) and fails loudly in CI (catches stale or forgotten artefacts). Update baselines via an explicit "regenerate baselines" workflow.

### Windows subpixel rendering noise (~0.5%)

Consecutive WebView2 / Chromium renders on Windows produce ~0.5% pixel-level mismatch with no UI change. macOS and Linux render deterministically. `MAX_MISMATCH_PCT = 1` is the lowest threshold that absorbs this noise reliably; real UI changes run ≥10%.

### Stabilising the page before snapshotting

Before any `checkScreen()` / `checkElement()` call:

```ts
await browser.execute(async () => { await document.fonts.ready; });
await browser.execute(() => {
  if (document.getElementById('wdio-vrt-stabilise')) return;
  const style = document.createElement('style');
  style.id = 'wdio-vrt-stabilise';
  style.textContent = `*, *::before, *::after {
    animation-duration: 0s !important;
    transition-duration: 0s !important;
  }`;
  document.head.appendChild(style);
});
```

Mask volatile regions (timestamps, avatars) using the visual service's `hideElements` / `removeElements` options.

### Linux: Xvfb display server (Tauri + Dioxus)

Tauri and Dioxus tests on Linux need a display server. Both stacks use wry → WebKitGTK, so wrap your test run with `xvfb-run` at 16-bit colour depth — 24-bit triggers GTK/WebKit pixbuf issues:

```bash
xvfb-run --auto-servernum --server-args="-screen 0 1280x1024x16" \
  pnpm wdio run wdio.visual.conf.ts
```

Electron does not need this — it manages its own display.

## Tauri provider notes

Tauri's three driver providers behave differently for VRT:

| Provider | Captures | Native chrome included? | Notes |
|---|---|---|---|
| `embedded` | Webview only | ❌ | Default, recommended for most users. Works on macOS, Linux, Windows. |
| `official` | Webview only | ❌ | Works on Windows. **Known issue on Linux** (see below). No macOS support. |
| `crabnebula` | OS window (incl. title bar) | ✅ | Captures via OS-level Screen Recording. **macOS CI is excluded** — see below. |

**Per-provider baselines are required.** Switching from `embedded` to `crabnebula` mid-suite would mismatch every baseline by ~30% because CrabNebula's screenshot includes the OS title bar and embedded's does not. Use the `<provider>` segment in your output path.

### Known issue: `official` provider on Linux

`tauri-driver` + WebKitGTK + `@wdio/tauri-service`'s `patchedExecute` interact badly with the visual service's `before()` hook. The hook calls `browser.execute('return window.devicePixelRatio')` which gets wrapped into an `executeAsync` HTTP call that never returns, timing out after ~2 minutes. The visual service then fails to register its commands and every assertion errors with `browser.checkScreen is not a function`.

Workaround: use the `embedded` provider on Linux for visual testing. The `official` provider works fine for non-visual specs there.

### Known issue: `crabnebula` on hosted macOS CI

CrabNebula's macOS driver captures via OS-level Screen Recording (AVFoundation / ScreenCaptureKit). Hosted GitHub Actions macOS runners can't grant Screen Recording permission programmatically (TCC has no scriptable approval path on hosted runners), so visual specs hang or error.

Workarounds:
- Run visual tests against the `embedded` provider on macOS CI.
- Use a self-hosted macOS runner with TCC pre-populated.
- Skip `crabnebula × macOS-CI × visual` from your matrix and rely on Linux / Windows coverage.

## Dioxus notes

Use the `embedded` provider for VRT on all platforms. The `external` provider is Windows-only in v1 and not recommended for visual testing — use `embedded` instead.

Per-provider baselines are not needed for Dioxus in v1 since only `embedded` is used; the default per-OS + per-arch layout is enough.

## Asserting native UI behaviour without pixels

The visual service captures **webview content only** (with the noted CrabNebula exception). Native menus, tray icons, file pickers, and OS-level dialogs aren't part of the capture and aren't worth pixel-diffing — they're OS-rendered and stable. Use your framework service's mock APIs instead — they intercept at the framework layer, where the native UI originates. The shape varies per framework; examples:

- **Electron** — see [API Reference](../packages/electron-service/docs/api-reference.md):
  ```ts
  const menuMock = await browser.electron.mock('Menu', 'setApplicationMenu');
  // … exercise the app …
  expect(menuMock).toHaveBeenCalled();
  ```
- **Tauri** — see [Usage Examples](../packages/tauri-service/docs/usage-examples.md) and [API Reference](../packages/tauri-service/docs/api-reference.md):
  ```ts
  const dialogMock = await browser.tauri.mock('plugin:dialog|open');
  dialogMock.mockReturnValue('/some/file');
  // … exercise the app …
  expect(dialogMock).toHaveBeenCalled();
  ```
- **Dioxus** — see [Usage Examples](../packages/dioxus-service/docs/usage-examples.md) and [API Reference](../packages/dioxus-service/docs/api-reference.md):
  ```ts
  const clipboardMock = await browser.dioxus.mock('clipboard_read');
  await clipboardMock.mockReturnValue('mocked clipboard text');
  // … exercise the app …
  expect(clipboardMock).toHaveBeenCalled();
  ```

`@wdio/visual-service` covers in-app UI; framework-service mock APIs cover native UI surfaces.

## Reference

- [`@wdio/visual-service` upstream docs](https://webdriver.io/docs/visual-testing/) — full API, comparison options, ResembleJS engine notes.
- [`@wdio/visual-service` GitHub](https://github.com/webdriverio/visual-testing) — issues, source.
- [wdio-desktop-mobile-example](https://github.com/goosewobbler/wdio-desktop-mobile-example) — working setup for every supported framework and (where applicable) per-provider variants, including a CI matrix.
- Related: [Video Recording](./video-recording.md) — debugging artefact (orthogonal to VRT, which is a regression signal).
