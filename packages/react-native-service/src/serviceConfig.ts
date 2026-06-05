// Option resolution shared by the launcher and worker service: merge global
// (service-level) options with per-capability options, capability taking
// precedence, and pull the custom-capability options off a capability object.

import { CUSTOM_CAPABILITY_NAME } from './constants.js';
import type { ReactNativeServiceGlobalOptions, ReactNativeServiceOptions } from './types.js';

/** Read the `wdio:reactNativeServiceOptions` block off a capability, if present. */
export function getServiceOptionsFromCapability(
  capability: { [CUSTOM_CAPABILITY_NAME]?: ReactNativeServiceOptions } | undefined,
): ReactNativeServiceOptions | undefined {
  return capability?.[CUSTOM_CAPABILITY_NAME];
}

/**
 * Merge service-level global options with per-capability options. Capability
 * options win on conflict, matching the precedence used across the sibling
 * services.
 */
export function mergeServiceOptions(
  globalOptions: ReactNativeServiceGlobalOptions = {},
  capabilityOptions: ReactNativeServiceOptions | undefined,
): ReactNativeServiceOptions {
  return { ...globalOptions, ...capabilityOptions };
}
