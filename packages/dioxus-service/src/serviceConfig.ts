import type { DioxusServiceGlobalOptions, DioxusServiceOptions } from './types.js';

// Capability options win over global options unless they are undefined.
export function mergeOptions(
  globalOptions: DioxusServiceGlobalOptions,
  capabilityOptions?: DioxusServiceOptions,
): DioxusServiceOptions {
  const definedCapabilityOptions = Object.fromEntries(
    Object.entries(capabilityOptions ?? {}).filter(([, value]) => value !== undefined),
  ) as DioxusServiceOptions;
  const merged: DioxusServiceOptions = { ...globalOptions, ...definedCapabilityOptions };
  return {
    ...merged,
    captureBackendLogs: merged.captureBackendLogs ?? false,
    captureFrontendLogs: merged.captureFrontendLogs ?? false,
    backendLogLevel: merged.backendLogLevel ?? 'info',
    frontendLogLevel: merged.frontendLogLevel ?? 'info',
  };
}
