import { type Stats, statSync } from 'node:fs';
import { createLogger } from '@wdio/native-utils';
import type { TauriServiceOptions } from './types.js';

const log = createLogger('tauri-service', 'utils');

function tryStat(path: string): Stats | undefined {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}

/**
 * Resolve the path to the built Tauri app binary that the launcher should
 * spawn. Matches `@wdio/dioxus-service`: the user supplies the literal
 * binary path (or a macOS `.app` bundle) and the service trusts it.
 *
 * Precedence:
 *   1. `tauri:options.application` from capabilities.
 *   2. `appBinaryPath` from `wdio:tauriServiceOptions`.
 *
 * A path that exists on disk but is a non-`.app` directory throws a
 * clear migration error (see `assertNotDirectory`). Path validity is
 * otherwise not checked here — the spawn at launch time surfaces a clear
 * OS error if the path is wrong. The previous "auto-resolve from a
 * project root" behaviour (the Tauri v1 single-crate
 * `<appPath>/src-tauri/target/debug/<productName>` pattern) was removed
 * because it never worked for Cargo workspaces, release builds, or any
 * non-default output dir — see issue #295.
 */
export function resolveAppBinaryPath(
  options: Pick<TauriServiceOptions, 'appBinaryPath'>,
  tauriOptions: { application?: string } | undefined,
): string {
  const fromCap = tauriOptions?.application;
  if (fromCap) {
    log.debug(`Using tauri:options.application: ${fromCap}`);
    assertNotDirectory(fromCap);
    return fromCap;
  }

  if (options.appBinaryPath) {
    log.debug(`Using appBinaryPath from wdio:tauriServiceOptions: ${options.appBinaryPath}`);
    assertNotDirectory(options.appBinaryPath);
    return options.appBinaryPath;
  }

  throw new Error(
    'Tauri application path not specified. ' +
      "Set 'tauri:options'.application or appBinaryPath in wdio:tauriServiceOptions " +
      "to the path of your built Tauri binary (e.g. 'target/release/my-app').",
  );
}

/**
 * Migration guard for users upgrading from v1.0.x: the launcher used to
 * auto-resolve a binary from a project directory by reading
 * `tauri.conf.json`. That resolver was removed because it broke for
 * Cargo workspaces, release builds, and several other common layouts.
 * If the user still passes a directory, surface a clear migration error
 * instead of letting `spawn` fail with `EISDIR` or "Permission denied".
 *
 * macOS `.app` bundles are directories but are valid launch targets, so
 * they're allowed through.
 */
function assertNotDirectory(path: string): void {
  const stat = tryStat(path);
  // Path doesn't exist or is unreadable — let `spawn` surface a clear ENOENT.
  if (stat?.isDirectory() && !path.endsWith('.app')) {
    throw new Error(
      `Tauri application path is a directory, not a binary: '${path}'.\n` +
        'As of @wdio/tauri-service v1.x, the legacy auto-resolver that walked ' +
        "'<appPath>/src-tauri/target/debug/<productName>' has been removed. " +
        "Set 'tauri:options'.application (or appBinaryPath in wdio:tauriServiceOptions) " +
        "to the path of your built Tauri binary — e.g. 'target/release/my-app' " +
        "or 'target/release/bundle/macos/My App.app' on macOS.",
    );
  }
}
