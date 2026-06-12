// Option resolution — a thin binding of @wdio/native-mobile-core's generic helpers
// to Flutter's custom-capability key + option type.

import {
  getServiceOptionsFromCapability as coreGetServiceOptionsFromCapability,
  mergeServiceOptions as coreMergeServiceOptions,
} from '@wdio/native-mobile-core';

import { CUSTOM_CAPABILITY_NAME } from './constants.js';
import type { FlutterServiceGlobalOptions, FlutterServiceOptions } from './types.js';

/** Read the `wdio:flutterServiceOptions` block off a capability, if present. */
export function getServiceOptionsFromCapability(
  capability: { [CUSTOM_CAPABILITY_NAME]?: FlutterServiceOptions } | undefined,
): FlutterServiceOptions | undefined {
  return coreGetServiceOptionsFromCapability<FlutterServiceOptions>(
    capability as Record<string, unknown> | undefined,
    CUSTOM_CAPABILITY_NAME,
  );
}

/** Merge service-level global options with per-capability options (capability wins). */
export function mergeServiceOptions(
  globalOptions: FlutterServiceGlobalOptions = {},
  capabilityOptions: FlutterServiceOptions | undefined,
): FlutterServiceOptions {
  return coreMergeServiceOptions<FlutterServiceOptions>(globalOptions, capabilityOptions);
}
