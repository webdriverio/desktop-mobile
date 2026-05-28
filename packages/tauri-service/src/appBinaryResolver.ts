import { statSync } from 'node:fs';
import { createLogger } from '@wdio/native-utils';
import { getTauriBinaryPath } from './pathResolver.js';
import type { TauriServiceOptions } from './types.js';

const log = createLogger('tauri-service', 'utils');

/**
 * Treat a path as a usable build artefact when:
 * - it points to an existing regular file (typical compiled binary), or
 * - it points to a macOS `.app` bundle (a directory ending in `.app`).
 *
 * Anything else (project root, `src-tauri/` dir, missing path) falls
 * through to the legacy resolver which knows how to walk a Tauri v1
 * single-crate layout.
 */
export function looksLikeBuiltBinary(candidate: string, platform: NodeJS.Platform = process.platform): boolean {
  try {
    const stat = statSync(candidate);
    if (stat.isFile()) return true;
    if (platform === 'darwin' && stat.isDirectory() && candidate.endsWith('.app')) return true;
    return false;
  } catch {
    return false;
  }
}

/**
 * Resolve the path to the built Tauri app binary that the service should
 * launch. Precedence matches `@wdio/dioxus-service`:
 *
 *   1. `tauri:options.application` from capabilities.
 *   2. `appBinaryPath` from `wdio:tauriServiceOptions`.
 *
 * The capability-level `application`, when given, is trusted as-is if it
 * already points at a usable build artefact (file, or `.app` bundle on
 * macOS). That lets users declare an exact binary path for layouts the
 * legacy resolver doesn't understand — Cargo workspaces (`target/` at the
 * workspace root, sibling to `src-tauri/`), release builds, or any
 * non-default output dir. Otherwise it falls back to
 * {@link getTauriBinaryPath}, which assumes the Tauri v1 single-crate
 * layout (`<appPath>/src-tauri/target/debug/<productName>`).
 *
 * Service-level `appBinaryPath` is always trusted as the literal binary
 * path — matching the Dioxus convention where `appBinaryPath` is an
 * escape hatch for the resolver, not an input to it.
 */
export async function resolveAppBinaryPath(
  options: Pick<TauriServiceOptions, 'appBinaryPath'>,
  tauriOptions: { application?: string } | undefined,
): Promise<string> {
  const fromCap = tauriOptions?.application;
  if (fromCap) {
    if (looksLikeBuiltBinary(fromCap)) {
      log.debug(`Trusting tauri:options.application as-is (built artefact): ${fromCap}`);
      return fromCap;
    }
    return getTauriBinaryPath(fromCap);
  }

  if (options.appBinaryPath) {
    log.debug(`Using appBinaryPath from wdio:tauriServiceOptions: ${options.appBinaryPath}`);
    return options.appBinaryPath;
  }

  throw new Error(
    'Tauri application path not specified. ' +
      "Set 'tauri:options'.application or appBinaryPath in wdio:tauriServiceOptions.",
  );
}
