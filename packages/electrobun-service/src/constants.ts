/** Logger namespace for this service (`createLogger(SERVICE_NAME, '<module>')`). */
export const SERVICE_NAME = 'electrobun-service';

/** WDIO capability key carrying per-capability service options. */
export const CUSTOM_CAPABILITY_NAME = 'wdio:electrobunServiceOptions';

/**
 * CEF auto-selects its remote-debugging port in [9222, 9232] at app startup, so
 * the launcher discovers the port by scanning the range rather than dictating
 * it. This is the low end of that range and the documented default.
 */
export const DEFAULT_REMOTE_DEBUGGING_PORT = 9222;

/** Explicit-port override env var (escape hatch; normally the port is discovered). */
export const REMOTE_DEBUGGING_PORT_ENV = 'ELECTROBUN_REMOTE_DEBUGGING_PORT';

/** Default label for the first/primary content webview target. */
export const DEFAULT_WINDOW_LABEL = 'main';
