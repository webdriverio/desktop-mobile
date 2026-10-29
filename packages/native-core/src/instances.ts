import { isMultiremote } from '@wdio/native-utils';

/** The capabilities shapes WebdriverIO hands a launcher hook. */
export type LauncherCapabilities<C> = C | C[] | Record<string, { capabilities: C }>;

/** The object WebdriverIO reads an instance's connection params from. */
export interface ConnectionTarget {
  hostname?: string;
  port?: number;
}

/** One instance's capabilities, as flattened by {@link normaliseInstanceCaps}. */
export interface InstanceCaps<C> {
  /** The multiremote instance name; undefined outside multiremote. */
  name?: string;
  /** The instance's capabilities. Capability keys go here. */
  caps: C;
  /** Where to set `hostname` and `port` so WebdriverIO connects this instance to a server the launcher started. */
  connectionTarget: ConnectionTarget;
}

/**
 * Flatten the capabilities a launcher hook receives (an array, one capabilities object, or a
 * multiremote record) into one entry per instance, holding the caller's objects by reference.
 *
 * A single session's `connectionTarget` is its caps object, which WebdriverIO hoists `hostname` and
 * `port` out of. A multiremote instance's is its outer `{ capabilities }` entry, because WebdriverIO
 * reads multiremote connection params only from there and ignores them inside the caps.
 */
export function normaliseInstanceCaps<C extends object>(capabilities: LauncherCapabilities<C>): InstanceCaps<C>[] {
  if (Array.isArray(capabilities)) {
    return capabilities.map((caps) => ({ caps, connectionTarget: caps as ConnectionTarget }));
  }
  const entries = Object.entries(capabilities);
  if (entries.length > 0 && entries.every(([, entry]) => isCapabilitiesEntry(entry))) {
    return (entries as Array<[string, { capabilities: C }]>).map(([name, entry]) => ({
      name,
      caps: entry.capabilities,
      connectionTarget: entry as ConnectionTarget,
    }));
  }
  const caps = capabilities as C;
  return [{ caps, connectionTarget: caps as ConnectionTarget }];
}

function isCapabilitiesEntry(value: unknown): value is { capabilities: object } {
  return value !== null && typeof value === 'object' && 'capabilities' in value;
}

/** What {@link forEachInstance} passes its callback besides the instance. */
export interface InstanceContext {
  /** The multiremote instance name; undefined outside multiremote. */
  name?: string;
  /** The capabilities the instance's session was requested with. */
  caps: WebdriverIO.Capabilities | undefined;
}

/**
 * Run `callback` on each session in turn: every instance of a multiremote browser, or the browser
 * itself.
 *
 * Pass the worker `before` hook's `capabilities` for the callback to get each instance's caps. A
 * single session gets `capabilities` as is. A multiremote instance gets the caps its session was
 * requested with, with a W3C `alwaysMatch` unwrapped, or else its entry in `capabilities`.
 */
export async function forEachInstance(
  browser: WebdriverIO.Browser | WebdriverIO.MultiRemoteBrowser,
  callback: (instance: WebdriverIO.Browser, context: InstanceContext) => unknown,
  capabilities?: unknown,
): Promise<void> {
  if (!isMultiremote(browser)) {
    await callback(browser, { caps: capabilities as WebdriverIO.Capabilities | undefined });
    return;
  }
  for (const name of browser.instances) {
    // v9 types getInstance as possibly undefined; a name from `instances` always resolves.
    const instance = browser.getInstance(name) as WebdriverIO.Browser;
    await callback(instance, { name, caps: requestedCapabilities(instance) ?? capabilitiesEntry(capabilities, name) });
  }
}

function requestedCapabilities(instance: WebdriverIO.Browser): WebdriverIO.Capabilities | undefined {
  const requested = (instance as { requestedCapabilities?: unknown }).requestedCapabilities;
  if (requested === null || typeof requested !== 'object') {
    return undefined;
  }
  if ('alwaysMatch' in requested) {
    return (requested as { alwaysMatch?: WebdriverIO.Capabilities }).alwaysMatch;
  }
  return requested as WebdriverIO.Capabilities;
}

function capabilitiesEntry(capabilities: unknown, name: string): WebdriverIO.Capabilities | undefined {
  const entry = (capabilities as Record<string, unknown> | undefined)?.[name];
  return isCapabilitiesEntry(entry) ? (entry.capabilities as WebdriverIO.Capabilities) : undefined;
}
