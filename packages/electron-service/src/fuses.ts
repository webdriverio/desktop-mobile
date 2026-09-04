import { createLogger } from '@wdio/native-utils';

const log = createLogger('electron-service', 'fuses');

export interface FuseCheckResult {
  canUseCdpBridge: boolean;
  fuseValue?: number;
  error?: string;
}

/**
 * Checks if the Electron binary has the EnableNodeCliInspectArguments fuse enabled.
 * The CDP bridge requires this fuse to be enabled (default) to work properly.
 *
 * @param binaryPath - Path to the Electron binary
 * @returns Result indicating whether CDP bridge can be used
 */
export async function checkInspectFuse(binaryPath: string): Promise<FuseCheckResult> {
  try {
    log.debug(`Checking EnableNodeCliInspectArguments fuse for: ${binaryPath}`);

    // biome-ignore lint/suspicious/noTsIgnore: @electron/fuses types may not resolve in all environments (e.g. CI)
    // @ts-ignore
    const { getCurrentFuseWire, FuseVersion, FuseV1Options, FuseState } = await import('@electron/fuses');
    const config = await getCurrentFuseWire(binaryPath);

    // If we can't read the config (e.g., older Electron version without fuses),
    // assume it's safe to proceed
    if (!config) {
      log.debug('No fuse config found (likely older Electron version), assuming CDP bridge is usable');
      return { canUseCdpBridge: true };
    }

    // Check if we have V1 fuses
    if (config.version === FuseVersion.V1) {
      const inspectFuse = config[FuseV1Options.EnableNodeCliInspectArguments];

      log.debug(`EnableNodeCliInspectArguments fuse value: ${inspectFuse}`);

      // The fuse is enabled by default (FuseState.ENABLE). If it's explicitly set to DISABLE,
      // the CDP bridge won't work
      if (inspectFuse === FuseState.DISABLE) {
        log.warn('EnableNodeCliInspectArguments fuse is disabled - CDP bridge will not work');
        return {
          canUseCdpBridge: false,
          fuseValue: inspectFuse,
        };
      }

      return { canUseCdpBridge: true, fuseValue: inspectFuse };
    }

    // No V1 fuses found, assume safe
    log.debug('No V1 fuses found, assuming CDP bridge is usable');
    return { canUseCdpBridge: true };
  } catch (error) {
    // If we can't read the fuses (e.g., invalid binary, permission issues),
    // log a warning but don't block - let the connection attempt fail naturally
    // with its own error message
    log.debug(`Failed to check fuses: ${error instanceof Error ? error.message : String(error)}`);
    log.debug('Proceeding with CDP bridge connection attempt');
    return {
      canUseCdpBridge: true,
      error: `Could not verify fuse configuration: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export interface RunAsNodeCheckResult {
  canRunAsNode: boolean;
  fuseValue?: number;
  error?: string;
}

/**
 * Checks whether the Electron binary may be run as a plain Node process (the
 * `RunAsNode` fuse). The Chromium-version probe sets `ELECTRON_RUN_AS_NODE=1`
 * and runs the binary with `-p`; if this fuse is disabled that env var is
 * ignored and the binary would launch the real GUI, so the probe must not run.
 *
 * Failing open on an unreadable fuse is safe: a disabled `RunAsNode` fuse is
 * always readable (that is how it gets flipped) and is caught below, so a read
 * failure means either no fuses at all (the env var is honoured) or an
 * inaccessible binary (the probe's own exec then fails harmlessly).
 *
 * @param binaryPath - Path to the Electron binary
 * @returns whether the binary may be run as a Node CLI
 */
export async function checkRunAsNodeFuse(binaryPath: string): Promise<RunAsNodeCheckResult> {
  try {
    log.debug(`Checking RunAsNode fuse for: ${binaryPath}`);

    // biome-ignore lint/suspicious/noTsIgnore: @electron/fuses types may not resolve in all environments (e.g. CI)
    // @ts-ignore
    const { getCurrentFuseWire, FuseVersion, FuseV1Options, FuseState } = await import('@electron/fuses');
    const config = await getCurrentFuseWire(binaryPath);

    if (!config) {
      return { canRunAsNode: true };
    }

    if (config.version === FuseVersion.V1) {
      const runAsNodeFuse = config[FuseV1Options.RunAsNode];
      log.debug(`RunAsNode fuse value: ${runAsNodeFuse}`);

      if (runAsNodeFuse === FuseState.DISABLE) {
        log.warn('RunAsNode fuse is disabled - skipping Chromium version probe to avoid launching the app');
        return { canRunAsNode: false, fuseValue: runAsNodeFuse };
      }

      return { canRunAsNode: true, fuseValue: runAsNodeFuse };
    }

    return { canRunAsNode: true };
  } catch (error) {
    log.debug(`Failed to check RunAsNode fuse: ${error instanceof Error ? error.message : String(error)}`);
    return {
      canRunAsNode: true,
      error: `Could not verify fuse configuration: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
