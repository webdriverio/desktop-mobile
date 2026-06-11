// Log capture for @wdio/react-native-service.
//
// Two channels:
//   1. Native device logs (Android: Appium 'logcat', iOS: Appium 'syslog') — polled
//      from the Appium session via browser.getLogs() after each test.
//   2. JS/Metro console logs — forwarded from Runtime.consoleAPICalled CDP events
//      over the Hermes bridge while it's connected.

import type { CdpBridge } from '@wdio/native-cdp-bridge';
import { shouldLog } from '@wdio/native-core';
import type { LogLevel } from '@wdio/native-types';
import { createLogger } from '@wdio/native-utils';

import { SERVICE_NAME } from './constants.js';

const log = createLogger(SERVICE_NAME, 'service');

export interface LogEntry {
  timestamp: number;
  level: string;
  message: string;
  source: 'device' | 'js';
}

/**
 * Map a CDP `Runtime.consoleAPICalled` type to a WDIO {@link LogLevel}. `console.log`
 * and any unrecognised type map to `info` so a default (`info`) `frontendLogLevel`
 * still captures them.
 */
function consoleTypeToLevel(type: string | undefined): LogLevel {
  switch (type) {
    case 'error':
      return 'error';
    case 'warning':
      return 'warn';
    case 'debug':
      return 'debug';
    default:
      return 'info';
  }
}

/** Map a logcat/syslog level string to a WDIO {@link LogLevel}. */
function deviceLevelToLevel(raw: string): LogLevel {
  switch (raw.toLowerCase()) {
    case 'error':
    case 'fatal':
      return 'error';
    case 'warn':
    case 'warning':
      return 'warn';
    case 'debug':
    case 'verbose':
    case 'trace':
      return 'debug';
    default:
      return 'info';
  }
}

/** Forward a message through the WDIO logger method matching its level. */
function forwardAtLevel(level: LogLevel, message: string): void {
  switch (level) {
    case 'error':
      log.error(message);
      break;
    case 'warn':
      log.warn(message);
      break;
    case 'trace':
    case 'debug':
      log.debug(message);
      break;
    default:
      log.info(message);
  }
}

/**
 * Start forwarding CDP `Runtime.consoleAPICalled` events from the Hermes bridge
 * into the WDIO logger. Returns a cleanup function that removes the listener.
 *
 * This captures `console.log/warn/error/info` calls made inside the React Native
 * JS bundle (Metro build) while the test is running. `minLevel` (the service's
 * `frontendLogLevel`, default `info`) drops anything below it.
 *
 * `Runtime.consoleAPICalled` is only dispatched once the Runtime domain is enabled, so we
 * send `Runtime.enable` before subscribing (matching electron-service's logCapture). It's
 * best-effort: log capture is opt-in (captureFrontendLogs) and an enable failure must not
 * break execute/mock — on failure we skip the subscription and return a no-op cleanup.
 *
 * The listener binds to the `CdpBridge` instance passed here. When `MetroBridge.connect()`
 * re-attaches after a drop it swaps in a fresh `CdpBridge`, so a caller that reconnects must run
 * the returned cleanup for the old bridge and re-invoke this against `bridge.bridge` to keep
 * forwarding live (ensureHermes does exactly this).
 */
export async function startJsLogForwarding(bridge: CdpBridge, minLevel: LogLevel = 'info'): Promise<() => void> {
  const handler = (params: unknown) => {
    const event = params as {
      type?: string;
      args?: Array<{ type?: string; value?: unknown; description?: string }>;
    };
    const level = consoleTypeToLevel(event.type);
    if (!shouldLog(level, minLevel)) {
      return;
    }
    const message = (event.args ?? [])
      .map((a) => (a.value !== undefined ? String(a.value) : (a.description ?? '')))
      .join(' ');
    forwardAtLevel(level, `[JS] ${message}`);
  };

  try {
    await bridge.send('Runtime.enable');
  } catch (error) {
    log.warn(`JS console capture disabled — Runtime.enable failed: ${(error as Error).message}`);
    return () => {};
  }

  bridge.on('Runtime.consoleAPICalled', handler);
  return () => {
    bridge.off('Runtime.consoleAPICalled', handler);
  };
}

/**
 * Collect native device logs from the Appium session since the last call.
 * Returns the raw log entries; callers decide how to forward them.
 *
 * `logType` is 'logcat' for Android or 'syslog' for iOS.
 */
export async function collectDeviceLogs(
  browser: WebdriverIO.Browser,
  logType: 'logcat' | 'syslog',
): Promise<LogEntry[]> {
  try {
    const raw = (await browser.getLogs(logType)) as Array<{
      timestamp?: number;
      level?: string;
      message?: string;
    }>;
    return raw.map((entry) => ({
      timestamp: entry.timestamp ?? Date.now(),
      level: entry.level ?? 'INFO',
      message: entry.message ?? '',
      source: 'device' as const,
    }));
  } catch (error) {
    log.debug(`collectDeviceLogs(${logType}) unavailable: ${(error as Error).message}`);
    return [];
  }
}

/**
 * Log all device entries via the WDIO logger. Called from the worker's afterTest
 * hook to forward the native device logs collected since the previous test.
 * `minLevel` (the service's `backendLogLevel`, default `info`) drops anything below it.
 */
export function forwardDeviceLogs(entries: LogEntry[], minLevel: LogLevel = 'info'): void {
  for (const entry of entries) {
    const level = deviceLevelToLevel(entry.level);
    if (!shouldLog(level, minLevel)) {
      continue;
    }
    forwardAtLevel(level, `[${entry.source.toUpperCase()}:${entry.level}] ${entry.message}`);
  }
}
