export const REQUEST_TIMEOUT = 10000;
export const DEFAULT_HOSTNAME = 'localhost';

/**
 * CEF's default remote-debugging port and the auto-scan range its renderer uses
 * when an app pins no port (`FindAvailableRemoteDebugPort(9222, 9232)` in the
 * native wrapper). The service launcher does NOT rely on the scan: it pins a
 * specific port per worker by writing `chromiumFlags.remote-debugging-port` into
 * that worker's bundle `build.json`, so the bridge connects to a known
 * `host:port`. This constant is the connection default/fallback.
 */
export const DEFAULT_PORT = 9222;
export const DEFAULT_PORT_RANGE_START = 9222;
export const DEFAULT_PORT_RANGE_END = 9232;

export const DEFAULT_MAX_RETRY_COUNT = 3;
export const DEFAULT_RETRY_INTERVAL = 100;

export const ERROR_MESSAGE = {
  TIMEOUT_CONNECTION: 'Request timeout exceeded waiting for response:',
  TIMEOUT_WAIT_PORT: 'Timeout exceeded while waiting for debugger port to open',
  DEBUGGER_NOT_FOUND: 'No debugger instance was detected',
  NO_PAGE_TARGETS: 'No CDP page targets were detected at the debugger endpoint',
  TARGET_NOT_FOUND: 'No CDP target is registered for label:',
  NOT_CONNECTED: "WebSocket is not connected. Call 'CdpBridge.connect()' before using this method",
  CONNECTION_CLOSED: 'WebSocket connection has been closed',
  ERROR_PARSE_JSON: 'Failed to parse JSON response:',
  ERROR_INTERNAL: 'Connection closed due to error:',
} as const;
