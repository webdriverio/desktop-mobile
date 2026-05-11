# Video Recording

Both `@wdio/electron-service` and `@wdio/tauri-service` compose cleanly with **[`wdio-video-reporter`](https://webdriver.io/docs/wdio-video-reporter/)**, which is the recommended way to record video of test runs for failure-debugging — comparable to Playwright's `recordVideo` or Cypress's built-in video capture.

This document covers the small amount of glue needed to wire it in, Tauri provider differences, and what to expect from the recorded output. The reporter itself is documented upstream — start at the [official guide](https://webdriver.io/docs/wdio-video-reporter/) for the full option surface.

A complete working example for both Electron and Tauri lives in the [wdio-desktop-mobile-example](https://github.com/goosewobbler/wdio-desktop-mobile-example) repo (electron-builder, electron-forge, electron-script, and tauri packages, each with `wdio.video.conf.ts` + `test/video/video.spec.ts`).

## What you get (and what you don't)

`wdio-video-reporter` captures via **screenshot stitching**, not a real video pipeline: it takes one screenshot after each command in a configurable allowlist (`click`, `setValue`, `keys`, navigation, etc.), optionally plus an interval timer, and stitches the frames into a `.webm` (or `.mp4`) at the end of each test. Practical consequences:

- **Resolution and content** match whatever `browser.saveScreenshot` returns (renderer-only on Electron and Tauri-embedded; OS window on Tauri-CrabNebula via that provider's Screen Recording path).
- **Frame rate is effectively the test's command rate**, not real video. With `videoSlowdownMultiplier: 3` (default) you get a 3–10 fps slideshow.
- **Cursor motion between frames is invisible** ([upstream #588](https://github.com/webdriverio-community/wdio-video-reporter/issues/588)).
- **Native dialogs, OS menus, tray pop-ups are not captured** — they're outside the webview, and the reporter is webview-scoped (with the noted CrabNebula exception).

This is fine for the canonical use case — "what happened during this failed test?" — but don't expect a smooth-playback screencast.

## Quick start

### 1. Install the reporter

```bash
npm install --save-dev wdio-video-reporter
```

The reporter bundles its own `ffmpeg` binary via `@ffmpeg-installer/ffmpeg` — no host install of ffmpeg is required. If your package manager blocks postinstall scripts (pnpm 10+), allow them for `@ffmpeg-installer/*`:

```jsonc
// package.json
{
  "pnpm": {
    "onlyBuiltDependencies": [
      "@ffmpeg-installer/darwin-arm64",
      "@ffmpeg-installer/darwin-x64",
      "@ffmpeg-installer/linux-x64",
      "@ffmpeg-installer/win32-x64"
    ]
  }
}
```

### 2. Wire it into your WDIO config

The reporter is added to the `reporters` array (not `services`). Per-OS / per-arch output folders keep artefacts from different runners from colliding.

**Electron** — _`wdio.conf.ts`_

```ts
import { join } from 'node:path';
import type { Options } from '@wdio/types';
import VideoReporter from 'wdio-video-reporter';

export const config: Options.Testrunner = {
  // ...
  services: ['electron'],
  capabilities: [{ browserName: 'electron' }],
  reporters: [
    'spec',
    [
      VideoReporter,
      {
        outputDir: join(__dirname, '__video__', process.platform, process.arch),
        // Retain on failure by default. Set to `true` locally if you want
        // every test to produce a video for debugging while developing.
        saveAllVideos: !process.env.CI,
        videoSlowdownMultiplier: 3,
      },
    ],
  ],
};
```

**Tauri** — _`wdio.conf.ts`_

```ts
import { join } from 'node:path';
import type { Options } from '@wdio/types';
import VideoReporter from 'wdio-video-reporter';

const driverProvider = 'embedded'; // or 'official' / 'crabnebula'

export const config: Options.Testrunner = {
  // ...
  services: [['@wdio/tauri-service', { driverProvider }]],
  capabilities: [{ browserName: 'tauri', 'wdio:enforceWebDriverClassic': true }],
  reporters: [
    'spec',
    [
      VideoReporter,
      {
        // Per-provider directory matters — see the Tauri provider notes below.
        outputDir: join(__dirname, '__video__', process.platform, process.arch, driverProvider),
        saveAllVideos: !process.env.CI,
        videoSlowdownMultiplier: 3,
      },
    ],
  ],
};
```

> **ESM configs** — `__dirname` is not defined in ES module configs (`"type": "module"` in `package.json`, or `wdio.conf.mts`). If your config is ESM, derive it from `import.meta.url` at the top of the file:
>
> ```ts
> import { dirname } from 'node:path';
> import { fileURLToPath } from 'node:url';
>
> const __dirname = dirname(fileURLToPath(import.meta.url));
> ```

### 3. Add `__video__` to `.gitignore`

Recorded artefacts are platform-specific and per-run — keep them out of version control.

```
# .gitignore
__video__
```

That's the entire setup. The reporter hooks into WDIO's existing command stream — no spec changes needed. Failing tests will produce `__video__/<platform>/<arch>/<test-slug>-<timestamp>.webm`; passing tests will not, unless `saveAllVideos: true`.

## When videos get retained

The reporter has two retention modes:

| `saveAllVideos` | Behaviour |
|---|---|
| `false` (default) | Record everything in memory; flush to disk only for failing tests. Mirrors Playwright's `retain-on-failure`. |
| `true` | Save every test's video to disk regardless of result. Convenient locally; large file output in long suites. |

The recommended config above uses `!process.env.CI` so:
- **Locally**: keep every video, useful for "did I break that thing?" exploration.
- **In CI**: retain only failures, keeps artefact uploads small.

> **Heads-up on `saveAllVideos: true`** — there's an [open upstream bug (#862)](https://github.com/webdriverio-community/wdio-video-reporter/issues/862) where the process can hang on exit with this setting on dynamic sites. We didn't observe it in our matrix, but our test apps are static; if your CI hangs after switching to `saveAllVideos: true`, that's the suspect. Default to `false` in CI to sidestep it.

## Tauri provider notes

Tauri's three driver providers behave differently for video recording:

| Provider | Captures | Native chrome included? | Notes |
|---|---|---|---|
| `embedded` | Webview only | ❌ | Default, recommended for most users. Works on macOS, Linux, Windows. |
| `official` | Webview only | ❌ | Works on Linux + Windows. No macOS support. Unlike the visual service, the `official` × Linux cell does **not** hit the `executeAsync` hang here — the reporter has no `before()` initialisation script. |
| `crabnebula` | OS window (incl. title bar) | ✅ | Captures via OS-level Screen Recording on macOS. **macOS CI is excluded** — see below. |

**Per-provider output directories are recommended.** A video recorded under `embedded` (webview only) looks very different from one recorded under `crabnebula` (full OS window) — keep them separate so you can compare like-for-like across runs.

### Known issue: `crabnebula` on hosted macOS CI

CrabNebula's macOS driver routes `browser.saveScreenshot` through OS-level Screen Recording (AVFoundation / ScreenCaptureKit). Hosted GitHub Actions macOS runners can't grant Screen Recording permission programmatically (TCC has no scriptable approval path on hosted runners), so video recording hangs or errors.

Workarounds:

- Run video recording against the `embedded` provider on macOS CI.
- Use a self-hosted macOS runner with TCC pre-populated for the runner user.
- Skip `crabnebula × macOS-CI × video` from your matrix and rely on Linux / Windows coverage.

The first option is the simplest if you just want failure recordings on macOS.

## Reference

- [`wdio-video-reporter` upstream docs](https://webdriver.io/docs/wdio-video-reporter/) — full API, all reporter options, framework-integration notes.
- [`wdio-video-reporter` GitHub](https://github.com/webdriverio-community/wdio-video-reporter) — issues, source, contribution guide.
- [wdio-desktop-mobile-example](https://github.com/goosewobbler/wdio-desktop-mobile-example) — working setup for all four target apps and all three Tauri providers, including a CI matrix.
- Related: [Visual Testing](./visual-testing.md) — the recommended approach for catching visual regressions (orthogonal to video recording: video is a debugging artefact, visual testing is a regression signal).
