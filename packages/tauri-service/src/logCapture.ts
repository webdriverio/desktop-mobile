// Tauri-flavoured wrapper around @wdio/native-core/logCapture.
//
// The actual readline plumbing and marker detection now lives in core. This
// wrapper preserves the Tauri-side `LogCaptureOptions` shape (with
// `options: TauriServiceOptions`) so the three existing call sites
// (driverProcess.ts, crabnebulaBackend.ts, embeddedProvider.ts) keep working
// unchanged. It translates the Tauri-style options into core's callback
// API by binding parseLogLine + forwardLog into an onLine callback and
// supplying Tauri's startup/error markers.

import type { Interface as ReadlineInterface } from 'node:readline';
import type { Readable } from 'node:stream';

import { createLogCapture as coreCreateLogCapture } from '@wdio/native-core';
import type { LogLevel } from '@wdio/native-types';

import { forwardLog } from './logForwarder.js';
import { parseLogLine } from './logParser.js';
import type { TauriServiceOptions } from './types.js';

export interface LogCaptureOptions {
  /** The stream to capture logs from (stdout or stderr) */
  stream: Readable | null;
  /** Identifier for logging purposes (e.g., 'embedded-4445', 'tauri-driver-0') */
  identifier: string;
  /** Service options controlling log capture behavior */
  options: TauriServiceOptions;
  /** Optional instance ID for multiremote support */
  instanceId?: string;
  /** Callback when startup is detected (tauri-driver mode) */
  onStartupDetected?: () => void;
  /** Callback when error is detected (tauri-driver mode) */
  onErrorDetected?: (message: string) => void;
}

const TAURI_STARTUP_MARKERS = ['tauri-driver started', 'listening on'] as const;
const TAURI_ERROR_MARKERS = ['can not listen'] as const;

/**
 * Create a Tauri-flavoured log capture handler for a stream (stdout/stderr).
 * Parses log lines via {@link parseLogLine} and forwards them via
 * {@link forwardLog} when the service options enable backend/frontend capture.
 */
export function createLogCapture(opts: LogCaptureOptions): ReadlineInterface | undefined {
  const { stream, identifier, options: serviceOptions, instanceId, onStartupDetected, onErrorDetected } = opts;

  return coreCreateLogCapture({
    stream,
    identifier,
    instanceId,
    startupMarkers: TAURI_STARTUP_MARKERS,
    errorMarkers: TAURI_ERROR_MARKERS,
    onStartupDetected,
    onErrorDetected,
    onLine: (line, inst) => {
      const parsed = parseLogLine(line);
      if (!parsed) return;

      if (serviceOptions.captureBackendLogs && parsed.source !== 'frontend') {
        const minLevel = (serviceOptions.backendLogLevel ?? 'info') as LogLevel;
        forwardLog('backend', parsed.level, parsed.message, minLevel, parsed.prefixedMessage, inst);
      }
      if (serviceOptions.captureFrontendLogs && parsed.source === 'frontend') {
        const minLevel = (serviceOptions.frontendLogLevel ?? 'info') as LogLevel;
        forwardLog('frontend', parsed.level, parsed.message, minLevel, parsed.prefixedMessage, inst);
      }
    },
  });
}
