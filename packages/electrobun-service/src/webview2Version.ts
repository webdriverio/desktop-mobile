import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { createLogger } from '@wdio/native-utils';

import { SERVICE_NAME } from './constants.js';

const log = createLogger(SERVICE_NAME, 'launcher');

const VERSION_DIR = /^\d+\.\d+\.\d+\.\d+$/;

/**
 * Detect the installed Evergreen **WebView2 runtime** version on Windows.
 *
 * WDIO auto-provisions msedgedriver to match the Edge **browser** (`msedge.exe`), but an
 * Electrobun app renders with the WebView2 **runtime** — a separate Evergreen install that can
 * lag the browser by a release. When they diverge (browser 149, runtime 148) the driver refuses
 * to attach (`session not created: … only supports Microsoft Edge version 149`). Returning the
 * runtime version lets the launcher pin `browserVersion` so the driver matches what it actually
 * drives, instead of whatever the runner's browser/`latest` happens to be.
 *
 * The runtime installs versioned dirs under `…\Microsoft\EdgeWebView\Application\<version>\`
 * (each holding `msedgewebview2.exe`). Returns the newest valid version, or `undefined` when not
 * found (the caller then falls back to WDIO's browser auto-match — i.e. today's behaviour).
 */
export function detectWebView2RuntimeVersion(): string | undefined {
  const bases = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(
    (base): base is string => Boolean(base),
  );

  let best: string | undefined;
  for (const base of bases) {
    const appDir = join(base, 'Microsoft', 'EdgeWebView', 'Application');
    if (!existsSync(appDir)) {
      continue;
    }
    let entries: string[];
    try {
      entries = readdirSync(appDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (VERSION_DIR.test(entry) && existsSync(join(appDir, entry, 'msedgewebview2.exe'))) {
        if (best === undefined || compareVersions(entry, best) > 0) {
          best = entry;
        }
      }
    }
  }

  if (best) {
    log.debug(`Detected WebView2 runtime version ${best}`);
  }
  return best;
}

/** Numeric compare of two `a.b.c.d` version strings. Returns >0 when `a` is newer. */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 4; i++) {
    if (pa[i] !== pb[i]) {
      return pa[i] - pb[i];
    }
  }
  return 0;
}
