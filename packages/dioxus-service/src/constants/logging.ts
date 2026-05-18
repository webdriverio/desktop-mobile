// Log-capture constants shared between logParser and logForwarder.

/**
 * Marker emitted by the bridge's log_bridge.rs every time a frontend
 * console.* call is forwarded. logParser splits on this token to classify
 * lines as 'frontend' vs 'backend'.
 *
 * Must match `wdio_dioxus_bridge::log_bridge::FRONTEND_MARKER` in the Rust
 * crate. If you change one, change the other.
 */
export const FRONTEND_MARKER = '[WDIO-FRONTEND]';

/**
 * Public prefixes used in formatted log output. The service stamps these
 * onto every line forwarded to the WDIO logger so multi-framework tests
 * can tell `[Dioxus:Backend]` lines apart from `[Tauri:Backend]` /
 * `[Electron:MainProcess]`.
 */
export const PREFIXES = {
  backend: '[Dioxus:Backend]',
  frontend: '[Dioxus:Frontend]',
} as const;

/** Format `[WDIO-FRONTEND][LEVEL] message`. */
export const WDIO_FRONTEND_PATTERN = /^\[WDIO-FRONTEND\]\[(INFO|WARN|ERROR|DEBUG|TRACE)\]\s*/i;
