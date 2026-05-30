/** Logger namespace for this service (`createLogger(SERVICE_NAME, '<module>')`). */
export const SERVICE_NAME = 'electrobun-service';

/** WDIO capability key carrying per-capability service options. */
export const CUSTOM_CAPABILITY_NAME = 'wdio:electrobunServiceOptions';

/**
 * CEF's documented default remote-debugging port and the floor of its auto-scan
 * range [9222, 9232] (used only when an app pins no port). The service does not
 * rely on this — it allocates a port and writes it into each worker's build.json.
 */
export const DEFAULT_REMOTE_DEBUGGING_PORT = 9222;

/**
 * Anchor for ports the launcher allocates (via PortManager) and writes into each
 * worker's bundle build.json. Kept clear of CEF's [9222, 9232] auto-scan range so
 * an allocated port can't collide with one CEF picks for an un-pinned app.
 */
export const DEFAULT_DEBUG_PORT_BASE = 9333;

/** Explicit-port override env var (escape hatch; normally the port is discovered). */
export const REMOTE_DEBUGGING_PORT_ENV = 'ELECTROBUN_REMOTE_DEBUGGING_PORT';

/** Default label for the first/primary content webview target. */
export const DEFAULT_WINDOW_LABEL = 'main';
