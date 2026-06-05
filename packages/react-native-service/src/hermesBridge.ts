import { CdpBridge, type CdpBridgeOptions } from '@wdio/native-cdp-bridge';

import { DEFAULT_METRO_HOST, DEFAULT_METRO_PORT } from './constants.js';
import { selectHermesTarget } from './hermesTarget.js';

/**
 * Options for {@link createHermesBridge}. Everything {@link CdpBridgeOptions}
 * accepts except `selectTarget`, which is fixed to the Hermes selector.
 */
export type HermesBridgeOptions = Omit<CdpBridgeOptions, 'selectTarget'>;

/**
 * The WebSocket `Origin` React Native's Fusebox inspector-proxy requires. Its
 * `verifyClient` CSRF check rejects upgrades whose Origin is not the proxy's own
 * server base URL, so this must equal `http://<host>:<port>`. An IPv6 host is
 * bracketed so its colons aren't confused with the port separator.
 */
export const metroOrigin = (host: string, port: number): string => {
  const bracketedHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `http://${bracketedHost}:${port}`;
};

/**
 * Build a single-target {@link CdpBridge} for a React Native app's Hermes
 * inspector behind Metro's inspector-proxy. Defaults the host/port to Metro's
 * (`localhost:8081`), wires in the {@link selectHermesTarget Hermes target
 * selector}, and sets the Fusebox-required `Origin` header (unless the caller
 * supplied one). The bridge stays dormant until `connect()`.
 */
export const createHermesBridge = (options: HermesBridgeOptions = {}): CdpBridge => {
  const host = options.host ?? DEFAULT_METRO_HOST;
  const port = options.port ?? DEFAULT_METRO_PORT;
  return new CdpBridge({
    ...options,
    host,
    port,
    origin: options.origin ?? metroOrigin(host, port),
    selectTarget: selectHermesTarget,
  });
};
