import type { LogLevel } from '@wdio/native-types';

import type { TauriServiceGlobalOptions, TauriServiceOptions } from './types.js';

export const DEFAULT_LOG_LEVEL: LogLevel = 'info';

// One merge rule for the launcher, worker and standalone session: capability options win unless undefined.
export function mergeServiceOptions(
  globalOptions: TauriServiceGlobalOptions = {},
  capabilityOptions?: TauriServiceOptions,
): TauriServiceOptions {
  const definedCapabilityOptions = Object.fromEntries(
    Object.entries(capabilityOptions ?? {}).filter(([, value]) => value !== undefined),
  ) as TauriServiceOptions;
  const merged: TauriServiceOptions = { ...globalOptions, ...definedCapabilityOptions };
  return {
    ...merged,
    captureBackendLogs: merged.captureBackendLogs ?? false,
    captureFrontendLogs: merged.captureFrontendLogs ?? false,
    backendLogLevel: merged.backendLogLevel ?? 'info',
    frontendLogLevel: merged.frontendLogLevel ?? 'info',
    logLevel: merged.logLevel ?? DEFAULT_LOG_LEVEL,
  };
}
