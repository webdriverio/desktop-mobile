/** Logger namespace for this service (`createLogger(SERVICE_NAME, '<module>')`). */
export const SERVICE_NAME = 'flutter-service';

/** WDIO capability key carrying per-capability service options. */
export const CUSTOM_CAPABILITY_NAME = 'wdio:flutterServiceOptions';

/** The native Appium context — deeplinks are native commands and must run here. */
export const NATIVE_CONTEXT = 'NATIVE_APP';

/**
 * Discovery budget for the Dart VM Service attach. The VM Service URL is logged by the
 * app a few seconds after launch (longer on a cold emulator/first launch), so poll for
 * ~60s before giving up — matching the React Native service's Hermes connect budget.
 */
export const VM_SERVICE_CONNECT_RETRIES = 60;
export const VM_SERVICE_CONNECT_INTERVAL_MS = 1000;

/**
 * Discovery budget for the best-effort pre-warm in `before()`. The pre-warm only wants the URL
 * if it's *already* discoverable at session start (the driver's `flutter:getVMServiceUrl` command, a
 * pinned port, or a "listening on …" line still in the log buffer); a single quick scrape suffices.
 * It must NOT run the full {@link VM_SERVICE_CONNECT_RETRIES} loop — that would block worker setup
 * for ~60s on a release build (no VM service) or any run without that command or a pin, including
 * find/tap-only tests that never touch the VM service. A miss falls through to the lazy path, which
 * keeps the full budget.
 */
export const VM_SERVICE_PREWARM_RETRIES = 1;

/**
 * Device-log line the Dart VM emits its service URL on (debug/profile builds):
 * e.g. `The Dart VM service is listening on http://127.0.0.1:PORT/TOKEN/`.
 * Captured to discover the URL when no `appium:dartVmServicePort` pin is set.
 */
export const VM_SERVICE_LOG_PATTERN = /Dart VM service is listening on (\S+)/i;
