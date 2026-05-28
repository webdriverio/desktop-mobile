import { createLogger } from '@wdio/native-utils';
import type { TauriServiceOptions } from './types.js';

const log = createLogger('tauri-service', 'utils');

/**
 * Resolve the path to the built Tauri app binary that the launcher should
 * spawn. Matches `@wdio/dioxus-service`: the user supplies the literal
 * binary path (or a macOS `.app` bundle) and the service trusts it.
 *
 * Precedence:
 *   1. `tauri:options.application` from capabilities.
 *   2. `appBinaryPath` from `wdio:tauriServiceOptions`.
 *
 * Path validity is not checked here — the spawn at launch time surfaces a
 * clear OS error if the path is wrong. The previous "auto-resolve from a
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
    return fromCap;
  }

  if (options.appBinaryPath) {
    log.debug(`Using appBinaryPath from wdio:tauriServiceOptions: ${options.appBinaryPath}`);
    return options.appBinaryPath;
  }

  throw new Error(
    'Tauri application path not specified. ' +
      "Set 'tauri:options'.application or appBinaryPath in wdio:tauriServiceOptions " +
      "to the path of your built Tauri binary (e.g. 'target/release/my-app').",
  );
}
