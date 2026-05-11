// Stream-based log capture skeleton.
//
// Extracted from packages/tauri-service/src/logCapture.ts. Provides the
// readline plumbing and driver-bring-up marker detection shared between
// Tauri and Dioxus (both spawn an external driver subprocess and need to
// surface its stdout/stderr).
//
// Parsing and forwarding are injected as callbacks because each service has
// its own log format (Tauri: `[Tauri:Backend]` prefixes filtered against
// `tauri-driver` patterns; Dioxus: TBD; Electron uses CDP, not streams).
// Keeping this module callback-driven means core has zero knowledge of any
// service's log conventions.
//
// Electron's `LogCaptureManager` (packages/electron-service/src/logCapture.ts)
// is intentionally NOT migrated here — it consumes CDP `Runtime.consoleAPICalled`
// events on a running Electron app, a fundamentally different domain.

import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import type { Readable } from 'node:stream';

import { createLogger } from '@wdio/native-utils';

const log = createLogger('native-core', 'launcher');

export interface StreamLogCaptureOptions {
  /** The stream to capture logs from (stdout or stderr). */
  stream: Readable | null;
  /** Identifier for diagnostic logging (e.g., 'embedded-4445', 'wdio-dioxus-driver-0'). */
  identifier: string;
  /** Optional instance ID for multiremote support; forwarded to `onLine`. */
  instanceId?: string;
  /** Callback when driver startup is detected (driver-process mode). */
  onStartupDetected?: () => void;
  /** Callback when a fatal driver error is detected (driver-process mode). */
  onErrorDetected?: (message: string) => void;
  /**
   * Substrings to match against each line to trigger `onStartupDetected`.
   * Each service supplies its own list — there is no default because the
   * markers are inherently driver-specific.
   */
  startupMarkers?: readonly string[];
  /**
   * Substrings to match against each line to trigger `onErrorDetected`.
   * Each service supplies its own list.
   */
  errorMarkers?: readonly string[];
  /**
   * Called for every non-empty line consumed from the stream. The service
   * is responsible for parsing, filtering, and forwarding. Receives the
   * raw line and the `instanceId` (if any) so the service's forwarder can
   * attach multiremote context.
   */
  onLine: (line: string, instanceId: string | undefined) => void;
}

/**
 * Create a log capture handler for a child-process stream (stdout/stderr).
 *
 * Wraps the stream in a readline interface, runs each line through
 * driver-bring-up marker detection (if callbacks are wired), and then
 * delegates to `onLine` for parsing and forwarding.
 *
 * Returns `undefined` if `stream` is null (caller can skip cleanup).
 */
export function createLogCapture(opts: StreamLogCaptureOptions): ReadlineInterface | undefined {
  const { stream, identifier, instanceId, onStartupDetected, onErrorDetected, startupMarkers, errorMarkers, onLine } =
    opts;

  if (!stream) {
    return undefined;
  }

  const rl = createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  rl.on('line', (line: string) => {
    if (onStartupDetected && startupMarkers?.some((m) => line.includes(m))) {
      onStartupDetected();
    }
    if (onErrorDetected && errorMarkers?.some((m) => line.includes(m))) {
      onErrorDetected(`Failed to bind: ${line}`);
    }

    onLine(line, instanceId);
  });

  rl.on('error', (err) => {
    log.warn(`[${identifier}] Stream error: ${err.message}`);
  });

  return rl;
}
