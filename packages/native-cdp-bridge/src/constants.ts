export const REQUEST_TIMEOUT = 10000;
export const DEFAULT_HOSTNAME = 'localhost';

/**
 * The conventional CDP remote-debugging port. Consumers that pin a specific
 * port (per worker, per device, etc.) pass `host`/`port` explicitly; this is the
 * connection default/fallback. (Renderer-specific port-scan ranges — e.g. CEF's —
 * live in the consuming service, not here.)
 */
export const DEFAULT_PORT = 9222;

export const DEFAULT_MAX_RETRY_COUNT = 3;
export const DEFAULT_RETRY_INTERVAL = 100;

/**
 * Lifecycle event emitted by {@link Connection}, {@link CdpBridge}, and
 * {@link MultiTargetCdpBridge} when the underlying WebSocket drops unexpectedly
 * (i.e. not as the result of an explicit `close()` call). The colon-namespace
 * ensures the name can never collide with a dotted CDP method name (e.g.
 * `Runtime.consoleAPICalled`).
 */
export const CDP_DISCONNECT_EVENT = 'cdp:disconnect' as const;

export const ERROR_MESSAGE = {
  TIMEOUT_CONNECTION: 'Request timeout exceeded waiting for response:',
  TIMEOUT_WAIT_PORT: 'Timeout exceeded while waiting for debugger port to open',
  DEBUGGER_NOT_FOUND: 'No debugger instance was detected',
  NO_PAGE_TARGETS: 'No CDP page targets were detected at the debugger endpoint',
  BRIDGE_CLOSED: 'CdpBridge is closed — create a new bridge to reconnect',
  TARGET_NOT_FOUND: 'No CDP target is registered for label:',
  NOT_CONNECTED: "WebSocket is not connected. Call 'connect()' before using this method",
  CONNECTION_CLOSED: 'WebSocket connection has been closed',
  ERROR_PARSE_JSON: 'Failed to parse JSON response:',
  ERROR_INTERNAL: 'Connection closed due to error:',
} as const;
