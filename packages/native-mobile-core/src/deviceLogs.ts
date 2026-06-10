// Native device-log capture for Appium mobile services (Android: 'logcat', iOS: 'syslog').
//
// Polled from the Appium session via browser.getLogs() — typically drained from the
// worker's afterTest hook so each test's lines attribute to it (getLogs drains everything
// since the last call). Framework-specific JS/Dart-realm log channels (RN's Hermes-CDP
// console forwarding, a Flutter VM-service stream) stay in each service package.

import { createLogger } from '@wdio/native-utils';

const log = createLogger('native-mobile-core', 'service');

export interface LogEntry {
  timestamp: number;
  level: string;
  message: string;
  /**
   * Always `'device'` (logcat/syslog) — the only kind this helper produces. A framework's
   * own realm-log channel (RN's Hermes console, a Flutter VM-service stream) forwards
   * directly via the logger, not as a `LogEntry`, so the union stays single-member here.
   */
  source: 'device';
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
