/**
 * WebDriverIO Tauri Plugin - Frontend TypeScript/JavaScript API
 * Provides execute and mocking interfaces for testing
 */

import type { InvokeArgs } from '@tauri-apps/api/core';
import * as nativeSpy from '@wdio/native-spy';
import { hasSemicolonOutsideQuotes, isFunctionSource } from '@wdio/native-utils/script-detect';

// Lazy-load invoke function to support both global Tauri API and dynamic imports
// This allows the plugin to work both with bundlers (Vite) and without (plain ES modules)
let _invokeCache: ((cmd: string, args?: InvokeArgs) => Promise<unknown>) | null = null;

async function getInvoke(): Promise<(cmd: string, args?: InvokeArgs) => Promise<unknown>> {
  if (_invokeCache) {
    return _invokeCache;
  }

  if (typeof window !== 'undefined') {
    // Prefer the snapshotted original core to avoid Proxy invariant violations when
    // setupInvokeInterception has replaced window.__TAURI__.core with a Proxy.
    const originalCore = window.__wdio_original_core__;
    if (originalCore?.invoke) {
      const invoke = originalCore.invoke.bind(originalCore);
      _invokeCache = invoke;
      return invoke;
    }

    // Fallback: use window.__TAURI__.core.invoke directly (safe when no proxy is installed)
    if (window.__TAURI__?.core?.invoke) {
      const invoke = window.__TAURI__.core.invoke;
      _invokeCache = invoke;
      return invoke;
    }
  }

  // Fallback to dynamic import for bundler environments
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    _invokeCache = invoke;
    return _invokeCache;
  } catch (_error) {
    throw new Error(
      'Tauri API not available. Make sure withGlobalTauri is enabled in tauri.conf.json or @tauri-apps/api is installed.',
    );
  }
}

// Type declarations for window extensions
declare global {
  interface Window {
    __TAURI__?: {
      core?: {
        invoke?: (cmd: string, args?: InvokeArgs) => Promise<unknown>;
      };
      log?: {
        trace?: (message: string) => Promise<void>;
        debug?: (message: string) => Promise<void>;
        info?: (message: string) => Promise<void>;
        warn?: (message: string) => Promise<void>;
        error?: (message: string) => Promise<void>;
      };
      event?: {
        listen?: (event: string, callback: (event: { payload: unknown }) => void) => Promise<() => void>;
        emit?: (event: string, payload: unknown) => Promise<void>;
      };
    };
    wdioTauri?: {
      execute: (script: string, options?: { windowLabel?: string }, argsJson?: string) => Promise<unknown>;
      waitForInit: () => Promise<void>;
      cleanupBackendLogListener?: () => void;
      cleanupFrontendLogListener?: () => void;
      cleanupInvokeInterception?: () => void;
      cleanupLogListeners: () => void;
      cleanupAll: () => void;
    };
    __wdio_spy__?: typeof nativeSpy;
    __wdio_mocks__?: Record<string, unknown>;
    __wdio_original_tauri__?: Window['__TAURI__'];
    __wdio_original_core__?: NonNullable<Window['__TAURI__']>['core'];
  }
}

/**
 * Cleanup registry to manage timers and event listeners
 * Prevents memory leaks from retry loops and orphaned listeners
 */
class CleanupRegistry {
  private timers = new Set<number>();
  private listeners = new Set<() => void>();

  addTimer(id: number): void {
    this.timers.add(id);
  }

  clearTimers(): void {
    this.timers.forEach((id) => {
      clearTimeout(id);
    });
    this.timers.clear();
  }

  addListener(fn: () => void): void {
    this.listeners.add(fn);
  }

  cleanup(): void {
    this.clearTimers();
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch {
        // Ignore cleanup errors
      }
    });
    this.listeners.clear();
  }
}

export const cleanupRegistry = new CleanupRegistry();

// Add page unload handler to cleanup automatically
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    cleanupRegistry.cleanup();
  });
}

/**
 * Options for execute function
 */
interface ExecuteOptions {
  /** Window label to execute in (optional) */
  windowLabel?: string;
}

/**
 * Execute JavaScript code in the frontend context. A function's source is called with
 * `{ core: { invoke } }` and then the user arguments
 * @param script - A function's source, or code to run as a function body
 * @param options - Execute options (optional)
 * @param argsJson - Serialized user arguments as JSON string (optional)
 * @returns Result of the script execution
 */
export async function execute(script: string, options?: ExecuteOptions, argsJson?: string): Promise<unknown> {
  if (!window.__TAURI__) {
    throw new Error('window.__TAURI__ is not available. Make sure withGlobalTauri is enabled in tauri.conf.json');
  }

  const trimmed = script.trim();

  let scriptToSend: string;

  if (isFunctionSource(trimmed)) {
    // Build a minimal tauri object with a mock-routing invoke. We deliberately avoid
    // spreading/Object.assign on window.__TAURI__ or window.__TAURI__.core because on
    // macOS/WKWebView those objects (or their Proxy wrappers installed by
    // setupInvokeInterception) can have non-configurable/non-writable own data properties that
    // trigger Proxy invariant violations when iterated. Only core.invoke is needed by scripts.
    scriptToSend = `
    (async () => {
      const __wdio_args = ${argsJson ?? '[]'};

      // Resolve the real invoke: prefer the snapshotted original (set by init() before any
      // Proxy was installed), fall back to window.__TAURI__.core.invoke.
      const __wdio_core_ref = window.__wdio_original_core__;
      let __wdio_invoke_real;
      if (__wdio_core_ref && typeof __wdio_core_ref.invoke === 'function') {
        __wdio_invoke_real = __wdio_core_ref.invoke.bind(__wdio_core_ref);
      } else {
        const startTime = Date.now();
        while (!window.__wdio_original_core__?.invoke && (Date.now() - startTime) < 5000) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        const coreRef = window.__wdio_original_core__;
        if (!coreRef?.invoke) throw new Error('Tauri core.invoke not available after 5s timeout');
        __wdio_invoke_real = coreRef.invoke.bind(coreRef);
      }

      const __wdio_invoke = async function(cmd, invokeArgs) {
        const mocks = window.__wdio_mocks__;
        if (mocks && typeof mocks[cmd] === 'function') {
          return mocks[cmd](invokeArgs);
        }
        return __wdio_invoke_real(cmd, invokeArgs);
      };

      // Plain object — no spreading of window.__TAURI__ to avoid Proxy invariant issues.
      const __wdio_tauri = { core: { invoke: __wdio_invoke } };
      return await (${script})(__wdio_tauri, ...__wdio_args);
    })()
  `.trim();
  } else {
    // Plain string script — not callable. Wrap as an async function body and apply the
    // user args so they are accessible via arguments[0], arguments[1], etc. (W3C §13.2.2).
    // Using a named function (not an arrow) is required: arrow functions have no arguments object.
    // No conditional async needed — the Tauri IPC always awaits the result.
    const hasStatementKeyword = /^(const|let|var|if|for|while|switch|throw|try|do|return)(?=[^\w$]|$)/.test(trimmed);
    const hasStatement = hasStatementKeyword || hasSemicolonOutsideQuotes(trimmed);
    const argsArray = argsJson ?? '[]';
    scriptToSend = hasStatement
      ? `(async function() { ${script} }).apply(null, ${argsArray})`
      : `(async function() { return ${script}; }).apply(null, ${argsArray})`;
  }

  const invoke = await getInvoke();
  try {
    const result = await invoke('plugin:wdio|execute', {
      request: {
        script: scriptToSend,
        args: [],
        window_label: options?.windowLabel,
      },
    } as InvokeArgs);
    return result;
  } catch (error) {
    throw new Error(`Failed to execute script: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// NOTE: Mock commands (setMock, getMock, clearMocks, resetMocks, restoreMocks) removed.
// Mocking is now JavaScript-only via window.__wdio_mocks__ and invoke interception.
// No backend Rust commands are needed for mocking - it's all handled in the frontend.

/**
 * Get the console forwarding setup code as a string
 * This can be injected into browser.execute() contexts
 */
export function getConsoleForwardingCode(): string {
  return `
    // Setup console forwarding to Tauri log plugin
    (function() {
      if (typeof window === 'undefined' || !window.__TAURI__?.log) {
        return;
      }

      // Store original methods
      const originalConsole = {
        log: console.log.bind(console),
        debug: console.debug.bind(console),
        info: console.info.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
      };

      // Helper to forward to Tauri log plugin
      // The log plugin outputs to stdout with target="frontend"
      function forward(level, args) {
        const message = Array.from(args).map(arg =>
          typeof arg === 'string' ? arg : JSON.stringify(arg)
        ).join(' ');

        // Call original console method
        originalConsole[level === 'trace' ? 'log' : level](message);

        // Forward to Tauri log plugin
        if (window.__TAURI__.log[level]) {
          window.__TAURI__.log[level](message).catch(() => {});
        }
      }

      // Wrap console methods using Object.defineProperty (works on WebKit)
      try {
        Object.defineProperty(console, 'log', {
          value: function() { forward('trace', arguments); },
          writable: true,
          configurable: true
        });
        Object.defineProperty(console, 'debug', {
          value: function() { forward('debug', arguments); },
          writable: true,
          configurable: true
        });
        Object.defineProperty(console, 'info', {
          value: function() { forward('info', arguments); },
          writable: true,
          configurable: true
        });
        Object.defineProperty(console, 'warn', {
          value: function() { forward('warn', arguments); },
          writable: true,
          configurable: true
        });
        Object.defineProperty(console, 'error', {
          value: function() { forward('error', arguments); },
          writable: true,
          configurable: true
        });
      } catch (err) {
        // If Object.defineProperty fails, console forwarding won't work
      }
    })();
  `;
}

/**
 * Forward console logs to Tauri log plugin or WDIO plugin's log_frontend command
 * This allows WebDriverIO to capture frontend console logs via the backend stdout
 */
function setupConsoleForwarding(): void {
  if (typeof window === 'undefined') {
    return;
  }

  // Helper function to safely forward to Tauri log plugin or WDIO plugin
  // Uses window.__TAURI__.log if available (requires tauri-plugin-log)
  // Falls back to WDIO plugin's log_frontend command (writes directly to stderr)
  async function forwardToTauri(level: 'trace' | 'debug' | 'info' | 'warn' | 'error', message: string): Promise<void> {
    try {
      // Try Tauri log plugin first
      if (window.__TAURI__?.log?.[level]) {
        await window.__TAURI__.log[level](message);
        return;
      }

      // Fallback to WDIO plugin's log_frontend command
      // This writes directly to stderr with [WDIO-FRONTEND] prefix
      if (window.__TAURI__?.core?.invoke) {
        await window.__TAURI__.core.invoke('plugin:wdio|log_frontend', {
          message,
          level,
        });
      }
    } catch {
      // Silently ignore if neither log plugin is available
    }
  }

  // Store original console methods
  const originalConsole = {
    log: console.log,
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error,
    trace: console.trace,
  };

  // Use Object.defineProperty to override console methods (works on WebKit)
  try {
    // Forward console.log to trace level
    Object.defineProperty(console, 'log', {
      value: (...args: unknown[]) => {
        const message = args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ');
        originalConsole.log(...args);
        forwardToTauri('trace', message).catch(() => {
          // Ignore errors
        });
      },
      writable: true,
      configurable: true,
    });

    // Forward console.debug
    Object.defineProperty(console, 'debug', {
      value: (...args: unknown[]) => {
        const message = args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ');
        originalConsole.debug(...args);
        forwardToTauri('debug', message).catch(() => {
          // Ignore errors
        });
      },
      writable: true,
      configurable: true,
    });

    // Forward console.info
    Object.defineProperty(console, 'info', {
      value: (...args: unknown[]) => {
        const message = args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ');
        originalConsole.info(...args);
        forwardToTauri('info', message).catch(() => {
          // Ignore errors
        });
      },
      writable: true,
      configurable: true,
    });

    // Forward console.warn
    Object.defineProperty(console, 'warn', {
      value: (...args: unknown[]) => {
        const message = args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ');
        originalConsole.warn(...args);
        forwardToTauri('warn', message).catch(() => {
          // Ignore errors
        });
      },
      writable: true,
      configurable: true,
    });

    // Forward console.error
    Object.defineProperty(console, 'error', {
      value: (...args: unknown[]) => {
        const message = args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ');
        originalConsole.error(...args);
        forwardToTauri('error', message).catch(() => {
          // Ignore errors
        });
      },
      writable: true,
      configurable: true,
    });

    // Forward console.trace
    Object.defineProperty(console, 'trace', {
      value: (...args: unknown[]) => {
        const message = args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ');
        originalConsole.trace(...args);
        forwardToTauri('trace', message).catch(() => {
          // Ignore errors
        });
      },
      writable: true,
      configurable: true,
    });
  } catch (_error) {
    // If Object.defineProperty fails, console forwarding won't work
    // Console logs will still work but won't be forwarded to Tauri log plugin
  }
}

/**
 * Setup invoke interception for mocking
 * This wraps window.__TAURI__.core.invoke to check for mocks before calling the real implementation
 * Retries until window.__TAURI__.core.invoke is available (with timeout)
 */
function setupInvokeInterception(): void {
  if (typeof window === 'undefined') {
    console.warn('[WDIO Tauri Plugin] Cannot setup invoke interception - window not available');
    return;
  }

  let attempts = 0;
  const maxAttempts = 50; // 50 attempts * 100ms = 5 seconds max
  const retryInterval = 100; // ms

  const trySetup = () => {
    attempts++;

    // Check if window.__TAURI__.core is available and is an object
    const core = window.__TAURI__?.core;
    if (!core || typeof core !== 'object') {
      if (attempts < maxAttempts) {
        console.log(`[WDIO Tauri Plugin] Waiting for window.__TAURI__.core (attempt ${attempts}/${maxAttempts})`);
        const timerId = window.setTimeout(trySetup, retryInterval);
        cleanupRegistry.addTimer(timerId);
        return;
      } else {
        console.warn('[WDIO Tauri Plugin] Timeout waiting for window.__TAURI__.core - invoke interception not set up');
        return;
      }
    }

    // Check if we already have an invoke interceptor set up
    if ((core as { _wdioInvokeInterceptor?: boolean })._wdioInvokeInterceptor) {
      console.log('[WDIO Tauri Plugin] Invoke interception already set up');
      return;
    }

    // Snapshot original references if init() ran before core was available
    if (!window.__wdio_original_tauri__) {
      window.__wdio_original_tauri__ = window.__TAURI__;
    }
    if (!window.__wdio_original_core__) {
      window.__wdio_original_core__ = core;
    }

    // Capture the current invoke as the base (mutable so setter can update it)
    let _baseInvoke: ((cmd: string, args?: InvokeArgs) => Promise<unknown>) | null =
      typeof (core as { invoke?: unknown }).invoke === 'function'
        ? (core as { invoke: (...args: unknown[]) => Promise<unknown> }).invoke.bind(core)
        : null;

    // Create a wrapped invoke function that always delegates to _baseInvoke for non-mocked commands
    const wrappedInvoke = async (cmd: string, args?: InvokeArgs): Promise<unknown> => {
      // Check if there's a mock for this command
      const mockFn = window.__wdio_mocks__?.[cmd];

      if (mockFn && typeof mockFn === 'function') {
        console.log(`[WDIO Tauri Plugin] Intercepted invoke for '${cmd}' - using mock`);
        try {
          const result = await (mockFn as (args: unknown) => Promise<unknown>)(args);
          return result;
        } catch (error) {
          console.error(`[WDIO Tauri Plugin] Mock error for '${cmd}':`, error);
          throw error;
        }
      }

      // No mock found, call the base invoke if available
      if (_baseInvoke) {
        return _baseInvoke(cmd, args);
      }

      // No base invoke, try to get it dynamically
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        return invoke(cmd, args);
      } catch (_error) {
        throw new Error(`Tauri API not available for command: ${cmd}`);
      }
    };

    // Strategy 1: getter/setter via Object.defineProperty (works on Linux/WebKitGTK)
    try {
      Object.defineProperty(core, 'invoke', {
        get() {
          return wrappedInvoke;
        },
        set(newInvoke: (cmd: string, args?: InvokeArgs) => Promise<unknown>) {
          _baseInvoke = typeof newInvoke === 'function' ? newInvoke : null;
        },
        configurable: true,
        enumerable: true,
      });
      (core as { _wdioInvokeInterceptor?: boolean })._wdioInvokeInterceptor = true;
      console.log('[WDIO Tauri Plugin] ✅ Invoke interception setup complete (defineProperty)');
      return;
    } catch (_defineError) {
      // invoke is non-configurable; defineProperty failed. Mock routing still works via
      // window.__wdio_mocks__ in execute()'s wrappedScript — invoke interception is not required.
      console.warn(
        '[WDIO Tauri Plugin] ⚠️ Invoke interception via defineProperty failed; mock routing via window.__wdio_mocks__ remains active',
      );
    }
  };

  trySetup();
}

/**
 * Setup event listener for backend logs
 * Backend emits 'backend-log' events that we forward to console for WebDriver capture
 * This bypasses tauri-driver's stdout limitation by routing through frontend console
 */
function setupBackendLogListener(): void {
  if (typeof window === 'undefined') {
    console.info('[WDIO][Frontend] setupBackendLogListener: window is undefined, skipping');
    return;
  }

  console.info('[WDIO][Frontend] Installing backend-log listener');

  const maxAttempts = 100;
  const retryInterval = 50;
  let attempts = 0;
  let removeListenerRef: (() => void) | null = null;

  const trySetup = () => {
    attempts++;

    if (attempts % 10 === 1) {
      console.info(`[WDIO][Frontend] Waiting for Tauri (attempt ${attempts}/${maxAttempts})`);
    }

    if (attempts >= maxAttempts) {
      console.warn('[WDIO][Frontend] Timeout waiting for Tauri - backend log listener not set up');
      return;
    }

    if (typeof window.__TAURI__ === 'undefined' || typeof window.__TAURI__.event === 'undefined') {
      const timerId = window.setTimeout(trySetup, retryInterval);
      cleanupRegistry.addTimer(timerId);
      return;
    }

    console.info('[WDIO][Frontend] Tauri ready - setting up backend-log listener');

    const setupListener = async () => {
      try {
        console.info('[WDIO][Frontend] Importing @tauri-apps/api/event');
        const { listen } = await import('@tauri-apps/api/event');
        console.info('[WDIO][Frontend] Event module imported successfully');

        const removeListener = await listen('backend-log', (event) => {
          console.info('[WDIO][Frontend] backend-log received:', event.payload);
          const logMessage = event.payload as string;
          console.info(logMessage);
        });

        removeListenerRef = removeListener;
        cleanupRegistry.addListener(removeListener);

        console.info('[WDIO][Frontend] Backend log listener registered successfully');

        if (!window.wdioTauri) {
          window.wdioTauri = {} as Window['wdioTauri'];
        }
        const wdioTauri = window.wdioTauri;
        if (!wdioTauri) {
          return;
        }
        wdioTauri.cleanupBackendLogListener = () => {
          if (removeListenerRef) {
            removeListenerRef();
            removeListenerRef = null;
          }
          console.log('[WDIO Tauri Plugin] Backend log listener cleaned up');
        };
      } catch (error) {
        console.log(`[WDIO Tauri Plugin] Failed to setup backend log listener: ${error}`);
      }
    };

    setupListener();
  };

  trySetup();
}

/**
 * Initialize the plugin frontend API
 * This sets up window.wdioTauri for backward compatibility with execute injection pattern
 */
export async function init(): Promise<void> {
  if (isInitialized) {
    console.log('[WDIO Tauri Plugin] Already initialized, skipping');
    return;
  }

  const messages: string[] = [];
  messages.push('[WDIO Tauri Plugin] Initializing...');
  messages.push(`[WDIO Tauri Plugin] typeof window: ${typeof window}`);

  if (typeof window === 'undefined') {
    messages.push('[WDIO Tauri Plugin] Window is undefined, skipping initialization');
    for (const msg of messages) {
      console.log(msg);
    }
    return;
  }

  messages.push(`[WDIO Tauri Plugin] window.__TAURI__ available: ${typeof window.__TAURI__ !== 'undefined'}`);
  messages.push(
    `[WDIO Tauri Plugin] window.__TAURI__?.core?.invoke available: ${typeof window.__TAURI__?.core?.invoke !== 'undefined'}`,
  );
  messages.push(`[WDIO Tauri Plugin] window.__TAURI__?.log available: ${typeof window.__TAURI__?.log !== 'undefined'}`);

  // Expose wdioTauri on window object for backward compatibility
  // Note: window.__TAURI__ might not be available immediately, but we can set up the API
  // The API functions will check for __TAURI__ when they're called
  // Mock commands are not exposed here - mocking is handled via window.__wdio_mocks__
  if (!window.wdioTauri) {
    window.wdioTauri = {} as Window['wdioTauri'];
  }
  const wdioTauriObj = window.wdioTauri as Window['wdioTauri'] & { execute: unknown; waitForInit: unknown };
  wdioTauriObj.execute = execute;
  wdioTauriObj.waitForInit = waitForInit;

  // Add cleanup functions
  wdioTauriObj.cleanupLogListeners = () => cleanupRegistry.cleanup();
  wdioTauriObj.cleanupInvokeInterception = () => {
    cleanupRegistry.clearTimers();
  };
  wdioTauriObj.cleanupAll = () => {
    wdioTauriObj.cleanupBackendLogListener?.();
    wdioTauriObj.cleanupFrontendLogListener?.();
    wdioTauriObj.cleanupInvokeInterception?.();
    cleanupRegistry.cleanup();
  };

  messages.push('[WDIO Tauri Plugin] window.wdioTauri set successfully');
  messages.push(
    `[WDIO Tauri Plugin] window.wdioTauri.execute: ${window.wdioTauri?.execute ? 'function' : 'undefined'}`,
  );

  // Log all messages (console.log is synchronous, will work immediately)
  for (const msg of messages) {
    console.log(msg);
  }

  // Use manual console forwarding instead of attachConsole()
  // This is required for WebDriver testing where console logs are executed
  // dynamically via browser.execute() contexts. The native attachConsole()
  // from @tauri-apps/plugin-log only captures logs from the static page context.
  console.log('[WDIO Tauri Plugin] Setting up manual console forwarding for WebDriver compatibility');
  setupConsoleForwarding();
  console.log('[WDIO Tauri Plugin] ✅ Console forwarding initialized');

  // Setup event listener for backend logs
  // Backend emits 'backend-log' events that we forward to console for WebDriver capture
  console.log('[WDIO Tauri Plugin] Setting up backend log event listener...');
  setupBackendLogListener();
  console.log('[WDIO Tauri Plugin] ✅ Backend log listener initialized');

  // Expose native spy on window for mock creation
  window.__wdio_spy__ = nativeSpy;

  // Snapshot the original core reference before setupInvokeInterception may mutate
  // window.__TAURI__.core (strategy 2) or wrap it in a Proxy.
  // The execute() wrappedScript uses this to avoid Proxy invariant violations on
  // macOS/WKWebView where core.invoke is non-configurable/non-writable.
  if (window.__TAURI__?.core) {
    window.__wdio_original_tauri__ = window.__TAURI__;
    window.__wdio_original_core__ = window.__TAURI__.core;
  }

  // Setup invoke interception for mocking support
  console.log('[WDIO Tauri Plugin] Setting up invoke interception for mocking...');
  setupInvokeInterception();

  // Log all accumulated messages now that forwarding is active
  for (const msg of messages) {
    console.log(msg);
  }

  // Test that console forwarding works
  console.info('[WDIO Tauri Plugin] TEST: This is a test INFO log after setupConsoleForwarding()');
  console.warn('[WDIO Tauri Plugin] TEST: This is a test WARN log after setupConsoleForwarding()');

  isInitialized = true;
}

// Auto-initialize when imported
// NOTE: We can't await at module level, but we start the initialization immediately
// and expose a promise that can be awaited by consumers if needed
let initPromise: Promise<void> | null = null;
let isInitialized = false;

if (typeof window !== 'undefined') {
  if (typeof document !== 'undefined' && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (!isInitialized) {
        initPromise = init();
      }
    });
  } else {
    if (!isInitialized) {
      initPromise = init();
    }
  }
}

/**
 * Wait for plugin initialization to complete
 * This can be called by the service to ensure attachConsole() has completed
 */
export async function waitForInit(): Promise<void> {
  if (initPromise) {
    await initPromise;
  }
}
