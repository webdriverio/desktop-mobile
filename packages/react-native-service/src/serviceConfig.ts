// Option resolution — a thin binding of @wdio/native-mobile-core's generic helpers
// to RN's custom-capability key + option type. The merge/read logic is shared.

import {
  getServiceOptionsFromCapability as coreGetServiceOptionsFromCapability,
  mergeServiceOptions as coreMergeServiceOptions,
} from '@wdio/native-mobile-core';

import { CUSTOM_CAPABILITY_NAME } from './constants.js';
import type { ReactNativeServiceGlobalOptions, ReactNativeServiceOptions } from './types.js';

/** Read the `wdio:reactNativeServiceOptions` block off a capability, if present. */
export function getServiceOptionsFromCapability(
  capability: { [CUSTOM_CAPABILITY_NAME]?: ReactNativeServiceOptions } | undefined,
): ReactNativeServiceOptions | undefined {
  return coreGetServiceOptionsFromCapability<ReactNativeServiceOptions>(
    capability as Record<string, unknown> | undefined,
    CUSTOM_CAPABILITY_NAME,
  );
}

/** Merge service-level global options with per-capability options (capability wins). */
export function mergeServiceOptions(
  globalOptions: ReactNativeServiceGlobalOptions = {},
  capabilityOptions: ReactNativeServiceOptions | undefined,
): ReactNativeServiceOptions {
  return coreMergeServiceOptions<ReactNativeServiceOptions>(globalOptions, capabilityOptions);
}
