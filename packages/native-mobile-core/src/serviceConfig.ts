// Option resolution shared by the launcher and worker service: merge global
// (service-level) options with per-capability options, capability taking
// precedence, and pull the custom-capability options off a capability object.
//
// Generic over the options type + the custom-capability key, so each service binds
// its own `wdio:<framework>ServiceOptions` key and option shape.

/** Read the `wdio:<framework>ServiceOptions` block off a capability, if present. */
export function getServiceOptionsFromCapability<TOptions>(
  capability: Record<string, unknown> | undefined,
  capKey: string,
): TOptions | undefined {
  return capability?.[capKey] as TOptions | undefined;
}

/**
 * Merge service-level global options with per-capability options. Capability
 * options win on conflict, matching the precedence used across the sibling
 * services.
 */
export function mergeServiceOptions<TOptions extends object>(
  globalOptions: Partial<TOptions> = {},
  capabilityOptions: TOptions | undefined,
): TOptions {
  return { ...globalOptions, ...capabilityOptions } as TOptions;
}
