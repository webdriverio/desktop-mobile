import type { DriverProvider, TauriServiceGlobalOptions, TauriServiceOptions } from './types.js';

export type ResolvedTauriServiceOptions = TauriServiceOptions & { driverProvider: DriverProvider };

// One merge rule for the launcher, worker and standalone session: capability options win unless undefined.
export function mergeServiceOptions(
  globalOptions: TauriServiceGlobalOptions = {},
  capabilityOptions?: TauriServiceOptions,
): ResolvedTauriServiceOptions {
  const definedCapabilityOptions = Object.fromEntries(
    Object.entries(capabilityOptions ?? {}).filter(([, value]) => value !== undefined),
  ) as TauriServiceOptions;
  const merged: TauriServiceOptions = { ...globalOptions, ...definedCapabilityOptions };
  return {
    ...merged,
    driverProvider: merged.driverProvider === 'official' ? 'external' : (merged.driverProvider ?? 'embedded'),
    captureBackendLogs: merged.captureBackendLogs ?? false,
    captureFrontendLogs: merged.captureFrontendLogs ?? false,
    backendLogLevel: merged.backendLogLevel ?? 'info',
    frontendLogLevel: merged.frontendLogLevel ?? 'info',
  };
}
