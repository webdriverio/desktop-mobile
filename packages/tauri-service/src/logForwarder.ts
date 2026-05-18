import { shouldLog } from '@wdio/native-core';
import type { LogLevel } from '@wdio/native-types';
import { createLogger } from '@wdio/native-utils';
import { getLogWriter, isLogWriterInitialized } from './logWriter.js';

export { shouldLog };

type WdioLogger = ReturnType<typeof createLogger>;

/**
 * Cached WDIO logger instance for normal test runner mode
 * Creating a new logger on every call causes unnecessary GC pressure
 */
let cachedLogger: WdioLogger | undefined;

function getLogger(): WdioLogger {
  if (!cachedLogger) {
    cachedLogger = createLogger('tauri-service', 'service');
  }
  return cachedLogger;
}

/**
 * Map Tauri log level to WDIO logger method
 */
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
 * Format log message with context
 * For multiremote, includes instance ID in the prefix (e.g., [Tauri:Backend:browserA])
 * Only adds prefix if message doesn't already have one
 */
function formatLogMessage(source: 'backend' | 'frontend', message: string, instanceId?: string): string {
  // Check if message already has [Tauri:Frontend] or [Tauri:Backend] prefix
  const hasTauriPrefix = /^\[Tauri:(Backend|Frontend)\]/i.test(message);
  if (hasTauriPrefix) {
    // Message already has prefix, just add instance ID if needed
    if (instanceId) {
      // Transform [Tauri:Backend] to [Tauri:Backend:instanceId]
      return message.replace(/(\[Tauri:(Backend|Frontend))\]/i, `$1:${instanceId}]`);
    }
    return message;
  }

  // Add new prefix
  const sourceLabel = source === 'frontend' ? 'Frontend' : 'Backend';
  const instanceLabel = instanceId ? `:${instanceId}` : '';
  return `[Tauri:${sourceLabel}${instanceLabel}] ${message}`;
}

/**
 * Transform prefixed message to include instance ID
 * Converts [Tauri:Backend] to [Tauri:Backend:browserA] for multiremote
 */
function transformPrefixedMessage(
  prefixedMessage: string,
  source: 'backend' | 'frontend',
  instanceId?: string,
): string {
  if (!instanceId) {
    return prefixedMessage;
  }

  const sourceLabel = source === 'frontend' ? 'Frontend' : 'Backend';
  const oldPrefix = `[Tauri:${sourceLabel}]`;
  const newPrefix = `[Tauri:${sourceLabel}:${instanceId}]`;

  if (prefixedMessage.startsWith(oldPrefix)) {
    return prefixedMessage.replace(oldPrefix, newPrefix);
  }

  return prefixedMessage;
}

/**
 * Forward a log message to WDIO logger or standalone file writer
 * @param source - Log source (backend or frontend)
 * @param level - Log level
 * @param message - Log message
 * @param minLevel - Minimum log level to capture
 * @param prefixedMessage - Optional pre-formatted message (takes precedence)
 * @param instanceId - Optional instance ID for multiremote (e.g., 'browserA')
 */
export function forwardLog(
  source: 'backend' | 'frontend',
  level: LogLevel,
  message: string,
  minLevel: LogLevel,
  prefixedMessage?: string,
  instanceId?: string,
): void {
  if (!shouldLog(level, minLevel)) {
    return;
  }

  // Transform prefixedMessage to include instance ID if provided
  const transformedPrefixed = prefixedMessage
    ? transformPrefixedMessage(prefixedMessage, source, instanceId)
    : undefined;
  const formattedMessage = transformedPrefixed || formatLogMessage(source, message, instanceId);

  // Check if we're in file logging mode (log writer initialized)
  const isInitialized = isLogWriterInitialized();
  if (isInitialized) {
    const writer = getLogWriter();
    writer.write(formattedMessage);
  } else {
    // Use cached WDIO logger (normal test runner mode)
    const logger = getLogger();
    const loggerMethod = getLoggerMethod(logger, level);
    loggerMethod(formattedMessage);
  }
}
