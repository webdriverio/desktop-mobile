export const REQUEST_TIMEOUT = 10000;
export const DEFAULT_HOSTNAME = 'localhost';

/**
 * Default CEF remote-debugging port. Electrobun's CEF renderer auto-selects a
 * free port in [DEFAULT_PORT_RANGE_START, DEFAULT_PORT_RANGE_END] at app startup
 * (`FindAvailableRemoteDebugPort(9222, 9232)` in its native wrapper), falling
 * back to 9222. The launcher therefore *discovers* which port an instance chose
 * by scanning the range rather than dictating it — see the service launcher.
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
