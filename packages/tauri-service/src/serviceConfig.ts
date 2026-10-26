import type { LogLevel } from '@wdio/native-types';

import type { TauriServiceGlobalOptions, TauriServiceOptions } from './types.js';

export const DEFAULT_LOG_LEVEL: LogLevel = 'info';
export const DEFAULT_COMMAND_TIMEOUT = 30_000;

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
    commandTimeout: merged.commandTimeout ?? DEFAULT_COMMAND_TIMEOUT,
  };
}

// Session creation keeps the longer startup timeout. This bounds every command after that.
export function applyCommandTimeout(browser: { options?: { connectionRetryTimeout?: number } }, timeout: number): void {
  if (!browser.options) return;
  browser.options.connectionRetryTimeout = timeout;
}
