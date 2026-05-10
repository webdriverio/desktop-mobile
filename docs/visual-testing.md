# Visual Regression Testing

Both `@wdio/electron-service` and `@wdio/tauri-service` compose cleanly with **[`@wdio/visual-service`](https://webdriver.io/docs/visual-testing/)**, which is the recommended way to do visual regression testing (VRT) for desktop apps built on these services.

This document covers the small amount of glue needed to wire it in, the per-OS baseline convention, Tauri provider differences, and when to reach for the existing mock APIs instead. The visual service itself is documented upstream — start at the [official guide](https://webdriver.io/docs/visual-testing/) for the full API surface.

A complete working example for both Electron and Tauri lives in the [wdio-desktop-mobile-example](https://github.com/goosewobbler/wdio-desktop-mobile-example) repo (electron-builder, electron-forge, electron-script, and tauri packages, each with `wdio.visual.conf.ts` + `test/visual/visual.spec.ts`).

## Quick start

### 1. Install the visual service

```bash
npm install --save-dev @wdio/visual-service
```

### 2. Wire it into your WDIO config

The visual service is added alongside the existing service entry. Per-OS and per-arch baseline folders avoid cross-platform font-rendering noise contaminating diffs.

**Electron** — _`wdio.conf.ts`_

```ts
import { join } from 'node:path';
import type { Options, Services } from '@wdio/types';

const visualService: Services.ServiceEntry = [
  'visual',
  {
    baselineFolder: join(__dirname, '__visual__', process.platform, process.arch, 'baseline'),
    screenshotPath: join(__dirname, '__visual__', process.platform, process.arch, 'actual'),
    formatImageName: '{tag}-{width}x{height}',
    autoSaveBaseline: !process.env.CI, // local-friendly, CI-strict
  },
];

export const config: Options.Testrunner = {
  // ...
  services: ['electron', visualService],
  capabilities: [{ browserName: 'electron' }],
};
```

**Tauri** — _`wdio.conf.ts`_

```ts
import { join } from 'node:path';
import type { Options, Services } from '@wdio/types';

const driverProvider = 'embedded'; // or 'official' / 'crabnebula'

const visualService: Services.ServiceEntry = [
  'visual',
  {
    // Per-provider directory matters — see the Tauri provider notes below.
    baselineFolder: join(__dirname, '__visual__', process.platform, process.arch, driverProvider, 'baseline'),
    screenshotPath: join(__dirname, '__visual__', process.platform, process.arch, driverProvider, 'actual'),
    formatImageName: '{tag}-{width}x{height}',
    autoSaveBaseline: !process.env.CI,
  },
];

export const config: Options.Testrunner = {
  // ...
  services: [['@wdio/tauri-service', { driverProvider }], visualService],
  capabilities: [{ browserName: 'tauri', 'wdio:enforceWebDriverClassic': true }],
};
```

### 3. Write a spec

```ts
import { $, browser, expect } from '@wdio/globals';

// Allow up to 1% mismatch — see "Cross-platform considerations" below for why.
const MAX_MISMATCH_PCT = 1;

describe('visual regression', () => {
  it('matches baseline of full screen', async () => {
    await browser.execute(() => document.fonts.ready);
    const result = await browser.checkScreen('home');
    expect(result).toBeLessThanOrEqual(MAX_MISMATCH_PCT);
  });
});
```

Run twice — first invocation writes the baseline (because `autoSaveBaseline` is `true` locally), second validates the match. Then introduce a UI change and re-run to confirm the diff is surfaced (mismatch will be ≫1%).

## Per-OS baselines are mandatory

Same app, different OS → different font rendering, different cursor positions, different anti-aliasing. There is no useful "one baseline for every OS" tolerance for desktop apps unless you pay for [Applitools](https://applitools.com/)' Visual AI.

The recommended layout — `__visual__/<platform>/<arch>/[<provider>/]...` — is the cheapest sane convention. Add `__visual__` to `.gitignore` if you want CI to manage baselines per-runner; check it in if you want explicit baseline review on PRs.

## Cross-platform considerations

### `autoSaveBaseline` for CI

The example above uses `!process.env.CI` so:
- Locally: missing baselines are written automatically — convenient.
- In CI: a missing baseline fails loudly (catches stale or forgotten artefacts) and only updates via an explicit "regenerate baselines" workflow.

### Windows subpixel rendering noise (~0.5%)

Consecutive WebView2 / Chromium renders on Windows produce ~0.5% pixel-level mismatch even with no UI change. macOS and Linux render deterministically. `MAX_MISMATCH_PCT = 1` is the lowest threshold that absorbs this noise reliably; real UI changes run ≥10% in practice.

### Stabilising the page before snapshotting

Borrowed from Playwright, run before any `checkScreen()` / `checkElement()` call:

```ts
await browser.execute(() => document.fonts.ready);
await browser.execute(() => {
  const style = document.createElement('style');
  style.textContent = `*, *::before, *::after {
    animation-duration: 0s !important;
    transition-duration: 0s !important;
  }`;
  document.head.appendChild(style);
});
```

Plus mask volatile regions (timestamps, avatars) using the visual service's `hideElements` / `removeElements` options.

## Tauri provider notes

Tauri's three driver providers behave differently for VRT:

| Provider | Captures | Native chrome included? | Notes |
|---|---|---|---|
| `embedded` | Webview only | ❌ | Default, recommended for most users. Works on macOS, Linux, Windows. |
| `official` | Webview only | ❌ | Works on Windows. **Known issue on Linux** (see below). No macOS support. |
| `crabnebula` | OS window (incl. title bar) | ✅ | Captures via OS-level Screen Recording. Requires macOS Screen Recording permission for the host process — non-trivial on hosted CI. |

**Per-provider baselines are required.** Switching from `embedded` to `crabnebula` mid-test-suite would mismatch every baseline by ~30% because CrabNebula's screenshot includes the OS title bar and embedded's does not. Use the `<provider>` placeholder in the baseline path as shown above.

### Known issue: `official` provider on Linux

The `tauri-driver` + WebKitGTK + `@wdio/tauri-service`'s `patchedExecute` wrapping interact badly with the visual service's `before()` hook. The hook calls `browser.execute('return window.devicePixelRatio')` which gets wrapped into an `executeAsync` HTTP call that never returns, timing out after ~2 minutes. The visual service then fails to register its commands and every assertion errors with `browser.checkScreen is not a function`.

Workaround: use the `embedded` provider on Linux for visual testing. The `official` provider works fine for non-visual specs there.

### Known issue: `crabnebula` on hosted macOS CI

CrabNebula's macOS driver captures via OS-level Screen Recording (AVFoundation / ScreenCaptureKit). Hosted GitHub Actions macOS runners can't grant Screen Recording permission programmatically (TCC has no scriptable approval path on hosted runners), so visual specs hang or error.

Workarounds:
- Run visual tests against the `embedded` provider on macOS CI.
- Use a self-hosted macOS runner with TCC pre-populated for the runner user.
- Skip `crabnebula × macOS-CI × visual` from your matrix and rely on Linux / Windows coverage.

The first option is the simplest if you just want VRT on macOS.

## Asserting native UI behaviour without pixels

The visual service captures **webview content only** (with the noted CrabNebula exception). Native menus, tray icons, file pickers, and OS-level dialogs aren't part of the capture and aren't worth pixel-diffing — they're OS-rendered and stable. To assert *behaviour* of those surfaces, use the existing mock APIs:

- **Electron** — see [Electron APIs](../packages/electron-service/docs/electron-apis.md) and [API Reference](../packages/electron-service/docs/api-reference.md):
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

The combination — `@wdio/visual-service` for the in-app UI, the mock APIs for native UI surfaces — is what most desktop-app test suites actually want.

## Reference

- [`@wdio/visual-service` upstream docs](https://webdriver.io/docs/visual-testing/) — full API, comparison options, ResembleJS engine notes.
- [`@wdio/visual-service` GitHub](https://github.com/webdriverio/visual-testing) — issues, source, contribution guide.
- [wdio-desktop-mobile-example](https://github.com/goosewobbler/wdio-desktop-mobile-example) — working VRT setup for all four target apps and all three Tauri providers, including a CI matrix.
