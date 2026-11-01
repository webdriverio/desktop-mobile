/**
 * Console wrapper script - readable source version
 * Minified by: pnpm --filter @wdio/tauri-service build:console-wrapper
 * Output:      src/scripts/console-wrapper.ts
 */

// These placeholders are substituted with actual values at build time
const CONSOLE_WRAPPED_KEY = '__WDIO_CONSOLE_WRAPPED__';
const LOG_FRONTEND_COMMAND = 'plugin:wdio|log_frontend';
const FRONTEND_PREFIX = '[Tauri:Frontend]';

// Console wrapper state - prevent double-wrapping using Symbol
(() => {
  const CONSOLE_WRAPPED = Symbol.for(CONSOLE_WRAPPED_KEY);
  if (console[CONSOLE_WRAPPED]) {
    return;
  }

  if (typeof window === 'undefined' || !window.__TAURI__ || !window.__TAURI__.core || !window.__TAURI__.core.invoke) {
    return;
  }

  console[CONSOLE_WRAPPED] = true;

  const originalConsole = {
    log: console.log.bind(console),
    debug: console.debug.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  const LogLevel = { Trace: 1, Debug: 2, Info: 3, Warn: 4, Error: 5 };
  const levelToString = {
    [LogLevel.Trace]: 'trace',
    [LogLevel.Debug]: 'debug',
    [LogLevel.Info]: 'info',
    [LogLevel.Warn]: 'warn',
    [LogLevel.Error]: 'error',
  };

  function forward(level, args) {
    const message = Array.from(args)
      .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
      .join(' ');

    const methodMap = {
      [LogLevel.Trace]: 'log',
      [LogLevel.Debug]: 'debug',
      [LogLevel.Info]: 'info',
      [LogLevel.Warn]: 'warn',
      [LogLevel.Error]: 'error',
    };
    const method = methodMap[level] || 'log';
    const originalMethod = originalConsole[method];

    if (originalMethod) {
      originalMethod.call(console, `${FRONTEND_PREFIX} ${message}`);
    }

    const levelStr = levelToString[level] || 'info';

    (() => {
      try {
        const invokePromise = window.__TAURI__.core.invoke(LOG_FRONTEND_COMMAND, {
          message: message,
          level: levelStr,
        });
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => {
            reject(new Error('Invoke timeout'));
          }, 5000);
        });
        Promise.race([invokePromise, timeoutPromise]);
      } catch (_e) {}
    })();
  }

  try {
    Object.defineProperty(console, 'log', {
      value: (...args) => {
        forward(LogLevel.Trace, args);
      },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(console, 'debug', {
      value: (...args) => {
        forward(LogLevel.Debug, args);
      },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(console, 'info', {
      value: (...args) => {
        forward(LogLevel.Info, args);
      },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(console, 'warn', {
      value: (...args) => {
        forward(LogLevel.Warn, args);
      },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(console, 'error', {
      value: (...args) => {
        forward(LogLevel.Error, args);
      },
      writable: true,
      configurable: true,
    });
  } catch (err) {
    originalConsole.warn('[WDIO Console Forwarding] Failed to override console methods:', err);
  }

  function cleanup() {
    try {
      Object.defineProperty(console, 'log', { value: originalConsole.log, writable: true, configurable: true });
      Object.defineProperty(console, 'debug', { value: originalConsole.debug, writable: true, configurable: true });
      Object.defineProperty(console, 'info', { value: originalConsole.info, writable: true, configurable: true });
      Object.defineProperty(console, 'warn', { value: originalConsole.warn, writable: true, configurable: true });
      Object.defineProperty(console, 'error', { value: originalConsole.error, writable: true, configurable: true });
      console[CONSOLE_WRAPPED] = undefined;
    } catch (_e) {}
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', cleanup);
    window.__wdioConsoleCleanup = cleanup;
  }
})();
