import { shouldLog } from '@wdio/native-core';
import type { LogLevel } from '@wdio/native-types';
import { createLogger } from '@wdio/native-utils';
import { getStandaloneLogWriter, isStandaloneLogWriterInitialized } from './logWriter.js';

export { shouldLog };

type WdioLogger = ReturnType<typeof createLogger>;

/**
 * Map Electron log level to WDIO logger method
 */
function getLoggerMethod(logger: WdioLogger, level: LogLevel): (message: string, ...args: unknown[]) => void {
  switch (level) {
    case 'trace':
    case 'debug':
      return (message: string, ...args: unknown[]) => logger.debug(message, ...args);
    case 'info':
      return (message: string, ...args: unknown[]) => logger.info(message, ...args);
    case 'warn':
      return (message: string, ...args: unknown[]) => logger.warn(message, ...args);
    case 'error':
      return (message: string, ...args: unknown[]) => logger.error(message, ...args);
    default:
      return (message: string, ...args: unknown[]) => logger.info(message, ...args);
  }
}

/**
 * Format log message with context
 */
function formatLogMessage(source: 'main' | 'renderer', message: string, instanceId?: string): string {
  const sourceLabel = source === 'renderer' ? 'Renderer' : 'MainProcess';
  const prefix = instanceId ? `[Electron:${sourceLabel}:${instanceId}]` : `[Electron:${sourceLabel}]`;
  return `${prefix} ${message}`;
}

/**
 * Forward a log message to WDIO logger or standalone file writer
 */
export function forwardLog(
  source: 'main' | 'renderer',
  level: LogLevel,
  message: string,
  minLevel: LogLevel,
  instanceId?: string,
): void {
  if (!shouldLog(level, minLevel)) {
    return;
  }

  const formattedMessage = formatLogMessage(source, message, instanceId);

  // Check if we're in standalone mode (log writer initialized)
  if (isStandaloneLogWriterInitialized()) {
    const writer = getStandaloneLogWriter();
    writer.write(formattedMessage);
  } else {
    // Use WDIO logger (normal test runner mode)
    const logger = createLogger('electron-service', 'service');
    const loggerMethod = getLoggerMethod(logger, level);
    loggerMethod(formattedMessage);
  }
}
