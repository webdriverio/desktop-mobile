import type { DioxusServiceGlobalOptions, DioxusServiceOptions } from './types.js';

export function mergeOptions(
  globalOptions: DioxusServiceGlobalOptions,
  capabilityOptions?: DioxusServiceOptions,
): DioxusServiceOptions {
  return {
    ...globalOptions,
    ...capabilityOptions,
    captureBackendLogs: capabilityOptions?.captureBackendLogs ?? globalOptions.captureBackendLogs ?? false,
    captureFrontendLogs: capabilityOptions?.captureFrontendLogs ?? globalOptions.captureFrontendLogs ?? false,
    backendLogLevel: capabilityOptions?.backendLogLevel ?? globalOptions.backendLogLevel ?? 'info',
    frontendLogLevel: capabilityOptions?.frontendLogLevel ?? globalOptions.frontendLogLevel ?? 'info',
  };
}
