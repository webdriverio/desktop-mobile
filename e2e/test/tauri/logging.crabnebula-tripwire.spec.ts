// Tripwire for #179 — Tauri logging under the CrabNebula provider on macOS.
//
// CrabNebula's closed-source `test-runner-backend` doesn't forward the macOS app's stdout/stderr, so
// the real logging specs (logging.spec.ts etc.) are excluded for the crabnebula provider in
// wdio.tauri.conf.ts and main stays green. That exclusion silently hides the day CrabNebula ships a
// fix. This spec is the inverse: it runs ONLY on macOS + crabnebula and asserts the app's backend
// logs are STILL not forwarded. While #179 is open it passes; the moment the forwarded line appears
// it fails — the signal to remove this spec, drop the crabnebula logging exclusions, and close #179.
//
// Two scoping details earlier revisions got wrong:
//   - macOS only — CrabNebula forwards logs fine on Linux/Windows, so the inverse assertion would
//     false-fire there. (Config also excludes this spec off macOS+crabnebula; the guard below is
//     defence in depth.)
//   - Specific forwarded content (`[Tauri:Backend] ... INFO level log`) rather than the bare
//     `[Tauri:Backend` prefix — the service emits that prefix for its own backend-process capture
//     even when the app's output is not forwarded, so a prefix check also false-fires.
//
// New CrabNebula releases arrive as their own Dependabot PR (.github/dependabot.yml); that PR's
// macOS tauri e2e run is what trips this wire.
import { browser } from '@wdio/globals';
import '@wdio/native-types';
import path from 'node:path';
import process from 'node:process';
import url from 'node:url';
import { getLogDirName, readWdioLogs } from '../../lib/utils.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const isMacOsCrabNebula = process.platform === 'darwin' && process.env.DRIVER_PROVIDER === 'crabnebula';

// The exact forwarded line logging.spec.ts asserts — present only if the app's backend output
// actually reaches the test process.
const FORWARDED_BACKEND_LOG = /\[Tauri:Backend[^\]]*\].*INFO level log/s;

// waitUntil's timeout message — also matched in the catch below so that ONLY a genuine timeout
// counts as "still not forwarded". Any other error (readWdioLogs I/O, session crash, …) is
// re-thrown and surfaces as a real failure instead of false-greening the tripwire.
const NOT_FORWARDED_TIMEOUT_MSG = 'app backend logs still not forwarded under CrabNebula';

function getLogDir() {
  return path.join(__dirname, '..', '..', 'logs', getLogDirName('standard', 'tauri', 'crabnebula'));
}

describe('CrabNebula logging tripwire (#179)', () => {
  it('should still NOT forward app backend logs under CrabNebula (fails when #179 is fixed)', async function () {
    if (!isMacOsCrabNebula) {
      this.skip();
    }

    await browser.tauri.execute(({ core }) => core.invoke('generate_test_logs'));

    // Give the forwarded output an ample window, then confirm it never arrived. waitUntil throwing
    // on timeout is the expected, healthy path while #179 is open; it resolving means the app's
    // backend logs now reach us — i.e. forwarding works.
    let forwarded = false;
    try {
      await browser.waitUntil(async () => FORWARDED_BACKEND_LOG.test(await readWdioLogs(getLogDir())), {
        timeout: 8000,
        timeoutMsg: NOT_FORWARDED_TIMEOUT_MSG,
      });
      forwarded = true;
    } catch (err) {
      // Only a waitUntil timeout means "still not forwarded" (the healthy state while #179 is open).
      // Anything else is a real failure — re-throw so it can't masquerade as a green tripwire.
      if (!(err instanceof Error) || !err.message.includes(NOT_FORWARDED_TIMEOUT_MSG)) {
        throw err;
      }
      forwarded = false;
    }

    if (forwarded) {
      throw new Error(
        'CrabNebula test-runner-backend now forwards app stdout/stderr on macOS — #179 looks fixed. ' +
          'Remove this tripwire spec, drop the crabnebula exclusion of logging.spec.ts / ' +
          'logging.tauri-driver.spec.ts / multiremote/logging.spec.ts in wdio.tauri.conf.ts (and the ' +
          'isCrabNebula skips inside logging.spec.ts), and close #179.',
      );
    }
  });
});
