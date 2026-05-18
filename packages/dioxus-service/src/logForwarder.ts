// Dioxus log forwarder.
//
// Receives parsed log records from parseLogLine (or directly from callers)
// and routes them to either:
//   1. The standalone log file (when @wdio/native-core's LogWriter for
//      'dioxus-service' has been initialised — typical of standalone-mode
//      session helpers).
//   2. The WDIO logger (test-runner mode).
//
// Each line is stamped with a `[Dioxus:Backend]` or `[Dioxus:Frontend]`
// prefix so multi-framework test runs can tell sources apart.

import { getLogWriter, isLogWriterInitialized, shouldLog } from '@wdio/native-core';
import type { LogLevel } from '@wdio/native-types';
import { createLogger } from '@wdio/native-utils';

import { PREFIXES } from './constants/logging.js';

const SERVICE_NAME = 'dioxus-service';

type WdioLogger = ReturnType<typeof createLogger>;

let cachedLogger: WdioLogger | undefined;

function getLogger(): WdioLogger {
  if (!cachedLogger) {
    cachedLogger = createLogger(SERVICE_NAME, 'service');
  }
  return cachedLogger;
}

function getLoggerMethod(logger: WdioLogger, level: LogLevel): (...args: unknown[]) => void {
  switch (level) {
    case 'trace':
    case 'debug':
      return logger.debug.bind(logger);
    case 'info':
      return logger.info.bind(logger);
    case 'warn':
      return logger.warn.bind(logger);
    case 'error':
      return logger.error.bind(logger);
    default:
      return logger.info.bind(logger);
  }
}

/**
 * Stamp the configured `[Dioxus:Backend]` / `[Dioxus:Frontend]` prefix on
 * `message`, optionally with a multiremote instance ID.
 */
function formatLogMessage(source: 'backend' | 'frontend', message: string, instanceId?: string): string {
  const prefix = source === 'frontend' ? PREFIXES.frontend : PREFIXES.backend;
  const instanceLabel = instanceId ? `:${instanceId}` : '';
  // Inject the instanceId before the closing bracket, e.g. [Dioxus:Backend:browserA]
  const stampedPrefix = instanceId ? prefix.replace(/\]$/, `${instanceLabel}]`) : prefix;
  return `${stampedPrefix} ${message}`;
}

/**
 * Forward a parsed log to the active sink. No-op when `level` is below
 * `minLevel` per [`shouldLog`].
 */
export function forwardLog(
  source: 'backend' | 'frontend',
  level: LogLevel,
  message: string,
  minLevel: LogLevel,
  instanceId?: string,
): void {
  if (!shouldLog(level, minLevel)) {
    return;
  }

  const formatted = formatLogMessage(source, message, instanceId);

  if (isLogWriterInitialized(SERVICE_NAME)) {
    getLogWriter(SERVICE_NAME).write(formatted);
    return;
  }

  const loggerMethod = getLoggerMethod(getLogger(), level);
  loggerMethod(formatted);
}
