import logger, { type Logger } from '@wdio/logger';
import debug from 'debug';

export type LogArea =
  | 'service'
  | 'launcher'
  | 'session'
  | 'bridge'
  | 'mock'
  | 'bundler'
  | 'config'
  | 'utils'
  | 'e2e'
  | 'fuses'
  | 'probe'
  | 'window'
  | 'triggerDeeplink';

// Handle CommonJS/ESM compatibility for @wdio/logger default export
const createWdioLogger = (logger as unknown as { default: typeof logger }).default || logger;

const areaCache = new Map<string, Logger>();

/**
 * Create a logger for a specific service and area
 * @param serviceName - Name of the service (e.g., 'electron-service', 'tauri-service')
 * @param area - Optional area within the service (e.g., 'launcher', 'bridge')
 */
export function createLogger(serviceName: string, area?: LogArea): Logger {
  if (!serviceName) {
    throw new Error('serviceName is required when creating a logger');
  }

  const areaKey = `${serviceName}:${area ?? ''}`;
  const cached = areaCache.get(areaKey);
  if (cached) return cached;
  const areaSuffix = area ? `:${area}` : '';
  const areaDebug = debug(`wdio-${serviceName}${areaSuffix}`);
  const areaLogger = createWdioLogger(`${serviceName}${areaSuffix}`);

  const wrapped: Logger = {
    ...areaLogger,
    debug: (...args: unknown[]) => {
      // Always forward to @wdio/logger so WDIO runner captures debug logs in outputDir
      // This ensures logs appear in CI log artifacts, not only in live console
      try {
        (areaLogger.debug as unknown as (...a: unknown[]) => void)(...args);
      } catch {
        console.log('🔍 DEBUG: Error in debug logger', args);
      }

      if (typeof args.at(-1) === 'object') {
        if (args.length > 1) {
          areaDebug(args.slice(0, -1));
        }
        areaDebug('%O', args.at(-1));
      } else {
        areaDebug(args);
      }
    },
  };

  areaCache.set(areaKey, wrapped);
  return wrapped;
}
