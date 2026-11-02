import type { LogLevel } from '@wdio/native-types';
import { mergeEnv } from '@wdio/native-utils';

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

// The app's environment: its configured env over process.env, and what the service sets for the instance over both
export function appEnv(
  options: Pick<TauriServiceOptions, 'env'> | undefined,
  serviceEnv?: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return mergeEnv(process.env, options?.env, serviceEnv);
}

// A JSON.stringify replacer for debug logs: env values, the service's or WebdriverIO's runnerEnv, can hold secrets,
// such as CN_API_KEY, so only their names show
export function hideEnvValues(key: string, value: unknown): unknown {
  return (key === 'env' || key === 'runnerEnv') && value !== null && typeof value === 'object'
    ? Object.keys(value)
    : value;
}

const EMBEDDED_START_TIMEOUT = 60_000;

// Takes merged options. Only the embedded provider waits for the app to start.
export function resolveStartTimeout(options: TauriServiceOptions): number {
  return options.startTimeout || EMBEDDED_START_TIMEOUT;
}
