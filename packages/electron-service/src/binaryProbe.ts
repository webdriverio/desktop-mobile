import { execFile } from 'node:child_process';
import { createLogger } from '@wdio/native-utils';
import { checkRunAsNodeFuse } from './fuses.js';

const log = createLogger('electron-service', 'probe');

// Dedupe probes of a shared binary: onPrepare probes every capability concurrently.
const probeCache = new Map<string, Promise<string | undefined>>();

const PROBE_TIMEOUT_MS = 10_000;
const CHROMIUM_VERSION_PATTERN = /^\d+\.\d+\.\d+/;

/**
 * Resolve an Electron build's Chromium version by running the binary as a Node
 * CLI (`ELECTRON_RUN_AS_NODE=1 <binary> -p process.versions.chrome`). Used as a
 * last resort when the Electron→Chromium map has no entry — nightly and forked
 * builds, or a release newer than the bundled map when the online lookup is
 * unavailable. `-p` does not load the app's main script, so no app code runs.
 *
 * Returns `undefined` on any failure, so the caller falls through to its existing error.
 */
export function probeChromiumVersion(binaryPath: string): Promise<string | undefined> {
  let pending = probeCache.get(binaryPath);
  if (!pending) {
    // Guard the "resolves undefined on failure" contract: a stray rejection must not surface as an
    // unhandled rejection, a cached rejected promise, or a fatal onPrepare error.
    pending = runProbe(binaryPath).catch(() => undefined);
    probeCache.set(binaryPath, pending);
    // Cache a success (a binary's Chromium version is stable) but not a failure — a transient
    // spawn/timeout/fuse-read failure must not poison later retries for the same binary.
    void pending.then((version) => {
      if (version === undefined && probeCache.get(binaryPath) === pending) {
        probeCache.delete(binaryPath);
      }
    });
  }
  return pending;
}

/** Test-only: clear the per-binary probe cache. */
export function resetProbeCache(): void {
  probeCache.clear();
}

async function runProbe(binaryPath: string): Promise<string | undefined> {
  const fuse = await checkRunAsNodeFuse(binaryPath);
  if (!fuse.canRunAsNode) {
    return undefined;
  }

  return new Promise((resolve) => {
    execFile(
      binaryPath,
      ['-p', 'process.versions.chrome'],
      {
        encoding: 'utf8',
        timeout: PROBE_TIMEOUT_MS,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) {
          log.debug(`Chromium version probe failed for ${binaryPath}: ${error.message}`);
          return resolve(undefined);
        }
        // Take the last version-shaped line: an inherited NODE_OPTIONS preload can print to stdout
        // before the `-p` result, so the version isn't guaranteed to lead (or be all of) stdout.
        const version = stdout
          .trim()
          .split(/\r?\n/)
          .map((line) => line.trim())
          .reverse()
          .find((line) => CHROMIUM_VERSION_PATTERN.test(line));
        if (version) {
          log.debug(`Probed Chromium v${version} from ${binaryPath}`);
          return resolve(version);
        }
        log.debug(
          `Chromium version probe returned unexpected output for ${binaryPath}: ${JSON.stringify(stdout.trim())}`,
        );
        resolve(undefined);
      },
    );
  });
}
