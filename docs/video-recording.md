# Video Recording

Both `@wdio/electron-service` and `@wdio/tauri-service` compose with **[`wdio-video-reporter`](https://webdriver.io/docs/wdio-video-reporter/)** for recording test runs — comparable to Playwright's `recordVideo` or Cypress's built-in video capture. This guide is the small amount you need on top of the [upstream guide](https://webdriver.io/docs/wdio-video-reporter/) — install quirks, output-path conventions, the Tauri provider matrix, and a known issue.

A complete working setup for Electron and Tauri (electron-builder, electron-forge, electron-script, and tauri packages, each with `wdio.video.conf.ts` + `test/video/video.spec.ts`) lives in the [wdio-desktop-mobile-example](https://github.com/goosewobbler/wdio-desktop-mobile-example) repo.

## What you get (and what you don't)

`wdio-video-reporter` captures via **screenshot stitching**, not a real video pipeline: it takes one screenshot after each command in a configurable allowlist (`click`, `setValue`, `keys`, navigation, etc.), optionally plus an interval timer, and stitches the frames into a `.webm` (or `.mp4`) at the end of each test. Practical consequences:

- **Resolution and content** match whatever `browser.saveScreenshot` returns (renderer-only on Electron and Tauri-embedded; OS window on Tauri-CrabNebula via that provider's Screen Recording path).
- **Frame rate is effectively the test's command rate**, not real video. With `videoSlowdownMultiplier: 3` (default) you get a 3–10 fps slideshow.
- **Cursor motion between frames is invisible** ([upstream #588](https://github.com/webdriverio-community/wdio-video-reporter/issues/588)).
- **Native dialogs, OS menus, tray pop-ups are not captured** — they're outside the webview, and the reporter is webview-scoped (with the noted CrabNebula exception).

Fine for "what happened during this failed test?"; don't expect a smooth-playback screencast.

## Quick start

### 1. Install the reporter

```bash
npm install --save-dev wdio-video-reporter
```

The reporter bundles `ffmpeg` via `@ffmpeg-installer/ffmpeg` — no host install needed. If your package manager blocks postinstall scripts (pnpm 10+), allow them for `@ffmpeg-installer/*`:

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

### 2. Add it to your WDIO config

The reporter is added to `reporters`, not `services`.

```ts
import { join } from 'node:path';
import VideoReporter from 'wdio-video-reporter';

const videoReporter = [
  VideoReporter,
  {
    outputDir: join(__dirname, '__video__', ...subdirs),
    saveAllVideos: !process.env.CI, // full video locally, retain-on-failure in CI
    videoSlowdownMultiplier: 3,
  },
];

// reporters: ['spec', videoReporter]
```

`...subdirs` resolves to `[process.platform, process.arch]` for Electron and `[process.platform, process.arch, driverProvider]` for Tauri — see [Output paths](#output-paths) for why.

> **Heads-up on `saveAllVideos: true`** — there's an [open upstream bug (#862)](https://github.com/webdriverio-community/wdio-video-reporter/issues/862) where the process can hang on exit with this setting on dynamic sites. Our test apps are static so we didn't observe it, but if your CI hangs after switching to `saveAllVideos: true`, this is the suspect. The `!process.env.CI` default above sidesteps it.

### 3. Ignore the output directory

```
# .gitignore
__video__
```

Recorded artefacts are platform-specific and per-run — keep them out of version control.

## Output paths

Per-OS / per-arch directories keep artefacts from different runners from colliding. For Tauri the per-provider segment matters too: a video recorded under `embedded` (webview only) looks very different from one recorded under `crabnebula` (full OS window) — keep them separate so you can compare like-for-like across runs.

- **Electron**: `__video__/<platform>/<arch>/<test-slug>-<timestamp>.webm`
- **Tauri**: `__video__/<platform>/<arch>/<provider>/<test-slug>-<timestamp>.webm`

Failing tests will produce a `.webm` under `outputDir`. Passing tests will not, unless `saveAllVideos: true`.

> **ESM configs** — `__dirname` is not defined in ES module configs (`"type": "module"` in `package.json`, or `wdio.conf.mts`). Derive it from `import.meta.url`:
>
> ```ts
> import { dirname } from 'node:path';
> import { fileURLToPath } from 'node:url';
> const __dirname = dirname(fileURLToPath(import.meta.url));
> ```

## Tauri provider notes

Tauri's three driver providers behave differently for video recording:

| Provider | Captures | Native chrome included? | Notes |
|---|---|---|---|
| `embedded` | Webview only | ❌ | Default, recommended for most users. Works on macOS, Linux, Windows. |
| `official` | Webview only | ❌ | Works on Linux + Windows. No macOS support. Unlike the visual service, this cell does **not** hit the `executeAsync` hang here — the reporter has no `before()` initialisation script. |
| `crabnebula` | OS window (incl. title bar) | ✅ | Captures via OS-level Screen Recording on macOS. **macOS CI is excluded** — see below. |

### Known issue: `crabnebula` on hosted macOS CI

CrabNebula's macOS driver routes `browser.saveScreenshot` through OS-level Screen Recording (AVFoundation / ScreenCaptureKit). Hosted GitHub Actions macOS runners can't grant Screen Recording permission programmatically (TCC has no scriptable approval path on hosted runners), so video recording hangs or errors.

Workarounds:
- Use the `embedded` provider on macOS CI.
- Use a self-hosted macOS runner with TCC pre-populated.
- Skip `crabnebula × macOS-CI × video` from your matrix and rely on Linux / Windows coverage.

## Reference

- [`wdio-video-reporter` upstream docs](https://webdriver.io/docs/wdio-video-reporter/) — full API, all reporter options, framework-integration notes.
- [`wdio-video-reporter` GitHub](https://github.com/webdriverio-community/wdio-video-reporter) — issues, source.
- [wdio-desktop-mobile-example](https://github.com/goosewobbler/wdio-desktop-mobile-example) — working setup for all four target apps and all three Tauri providers, including a CI matrix.
- Related: [Visual Regression Testing](./visual-testing.md) — regression signal (orthogonal to video, which is a debugging artefact).
