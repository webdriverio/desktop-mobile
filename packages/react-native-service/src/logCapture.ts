// Log capture for @wdio/react-native-service.
//
// Two channels:
//   1. Native device logs (Android: Appium 'logcat', iOS: Appium 'syslog') — polled
//      from the Appium session via browser.getLogs() after each test.
//   2. JS/Metro console logs — forwarded from Runtime.consoleAPICalled CDP events
//      over the Hermes bridge while it's connected.

import type { CdpBridge } from '@wdio/native-cdp-bridge';
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
 * Start forwarding CDP `Runtime.consoleAPICalled` events from the Hermes bridge
 * into the WDIO logger. Returns a cleanup function that removes the listener.
 *
 * This captures `console.log/warn/error/info` calls made inside the React Native
 * JS bundle (Metro build) while the test is running.
 *
 * The listener binds to the `CdpBridge` instance passed here. When `MetroBridge.connect()`
 * re-attaches after a drop it swaps in a fresh `CdpBridge`, so a caller that reconnects must run
 * the returned cleanup for the old bridge and re-invoke this against `bridge.bridge` to keep
 * forwarding live (ensureHermes does exactly this).
 */
export function startJsLogForwarding(bridge: CdpBridge): () => void {
  const handler = (params: unknown) => {
    const event = params as {
      type?: string;
      args?: Array<{ type?: string; value?: unknown; description?: string }>;
    };
    const level = event.type ?? 'log';
    const message = (event.args ?? [])
      .map((a) => (a.value !== undefined ? String(a.value) : (a.description ?? '')))
      .join(' ');

    switch (level) {
      case 'warning':
        log.warn(`[JS] ${message}`);
        break;
      case 'error':
        log.error(`[JS] ${message}`);
        break;
      case 'info':
        log.info(`[JS] ${message}`);
        break;
      default:
        log.debug(`[JS] ${message}`);
    }
  };

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
 */
export function forwardDeviceLogs(entries: LogEntry[]): void {
  for (const entry of entries) {
    const msg = `[${entry.source.toUpperCase()}:${entry.level}] ${entry.message}`;
    const level = entry.level.toLowerCase();
    if (level === 'error' || level === 'fatal') {
      log.error(msg);
    } else if (level === 'warn' || level === 'warning') {
      log.warn(msg);
    } else {
      log.debug(msg);
    }
  }
}
