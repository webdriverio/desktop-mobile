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
 * Whether the Electron binary may run as a plain Node process (the `RunAsNode`
 * fuse). The Chromium probe runs `ELECTRON_RUN_AS_NODE=1 <binary> -p …`; if this
 * fuse is disabled the env var is ignored and the binary launches its real GUI,
 * so the probe must be skipped.
 *
 * Fail-open on a read error: usually that means no fuses (env var honoured) or
 * an inaccessible binary (the probe's own exec then fails harmlessly). The rare
 * exception is a fuse wire this @electron/fuses can't parse — a disabled fuse
 * could then be probed and briefly flash the GUI — but failing closed would skip
 * the probe for every unreadable-but-fine binary, defeating its purpose.
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
