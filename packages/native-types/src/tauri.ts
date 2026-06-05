import type { Mock } from '@wdio/native-spy';
import type { Capabilities, Options } from '@wdio/types';
import type {
  AbstractFn,
  BaseServiceGlobalOptions,
  BaseServiceOptions,
  BrowserBase,
  DriverProviderConfig,
  LogLevel,
  MockOverride,
  MockResult,
  Result,
  ServiceMockContext,
} from './shared.js';

// ============================================================================
// Tauri-Specific Types
// ============================================================================

/**
 * Tauri APIs object type - matches window.__TAURI__ structure
 */
export interface TauriAPIs {
  core: {
    invoke: (command: string, ...args: unknown[]) => Promise<unknown>;
  };
  app?: {
    getName: () => Promise<string>;
    getVersion: () => Promise<string>;
  };
  window?: unknown;
  event?: unknown;
  [key: string]: unknown;
}

/**
 * Tauri mock context
 */
interface TauriMockContext extends ServiceMockContext {
  results: MockResult[];
}

/**
 * Tauri mock instance interface
 */
export interface TauriMockInstance extends Omit<Mock, MockOverride> {
  mockImplementation(fn: AbstractFn): Promise<TauriMock>;
  mockImplementationOnce(fn: AbstractFn): Promise<TauriMock>;
  mockReturnValue(obj: unknown): Promise<TauriMock>;
  mockReturnValueOnce(obj: unknown): Promise<TauriMock>;
  mockResolvedValue(obj: unknown): Promise<TauriMock>;
  mockResolvedValueOnce(obj: unknown): Promise<TauriMock>;
  mockRejectedValue(obj: unknown): Promise<TauriMock>;
  mockRejectedValueOnce(obj: unknown): Promise<TauriMock>;
  mockClear(): Promise<TauriMock>;
  mockReset(): Promise<TauriMock>;
  mockRestore(): Promise<TauriMock>;
  mockReturnThis(): Promise<TauriMock>;
  withImplementation<ReturnValue, InnerArguments extends unknown[]>(
    implFn: AbstractFn,
    callbackFn: (tauri: TauriAPIs, ...innerArgs: InnerArguments) => ReturnValue,
  ): Promise<ReturnValue>;
  mockName(name: string): TauriMock;
  getMockName(): string;
  getMockImplementation(): AbstractFn | undefined;
  update(): Promise<TauriMock>;
  __isTauriMock: boolean;
  mock: TauriMockContext;
}

/**
 * Tauri mock function type
 */
export interface TauriMock<TArgs extends unknown[] = unknown[], TReturns = unknown> extends TauriMockInstance {
  new (...args: TArgs): TReturns;
  (...args: TArgs): TReturns;
}

/**
 * Tauri event target descriptor — mirrors the EventTarget union from
 * @tauri-apps/api/event without requiring a runtime dependency on it.
 */
export type TauriEventTarget =
  | { kind: 'Any' }
  | { kind: 'AnyLabel'; label: string }
  | { kind: 'App' }
  | { kind: 'Window'; label: string }
  | { kind: 'Webview'; label: string }
  | { kind: 'WebviewWindow'; label: string };

/**
 * Options for browser.tauri.execute() per-call overrides
 * Use withExecuteOptions() from @wdio/tauri-service to create properly-typed options
 */
export interface TauriExecuteOptions {
  /**
   * Window label to target for this execute call.
   * Overrides the session default windowLabel.
   */
  windowLabel?: string;
  /**
   * Sentinel property - set automatically by withExecuteOptions()
   * @internal - do not set manually
   */
  __wdioOptions__: true;
}

/**
 * Tauri Service API interface for browser object
 */
export interface TauriServiceAPI {
  /**
   * Execute JavaScript code with per-call options and arguments.
   *
   * @example
   * ```js
   * const result = await browser.tauri.execute(
   *   (tauri, name) => tauri.core.invoke('greet', { name }),
   *   { windowLabel: 'popup' },
   *   'Alice'
   * );
   * ```
   */
  execute<ReturnValue, InnerArguments extends unknown[]>(
    script: string | ((tauri: TauriAPIs, ...innerArgs: InnerArguments) => ReturnValue),
    options: TauriExecuteOptions,
    ...args: InnerArguments
  ): Promise<ReturnValue>;

  /**
   * Execute JavaScript code in the Tauri frontend context with access to Tauri APIs.
   *
   * @example
   * ```js
   * const result = await browser.tauri.execute(({ core }) => core.invoke('get_platform_info'));
   * ```
   *
   * @param script - Function to execute (receives Tauri APIs as first parameter) or string
   * @param args - Additional arguments passed to the script
   */
  execute<ReturnValue, InnerArguments extends unknown[]>(
    script: string | ((tauri: TauriAPIs, ...innerArgs: InnerArguments) => ReturnValue),
    ...args: InnerArguments
  ): Promise<ReturnValue>;

  /**
   * Check if a value is a Tauri mock function or if a command is mocked.
   * Accepts either a mock function object or a command name string.
   *
   * @param commandOrFn - Command name (string) or mock function object to check
   * @returns True if the command is mocked or the value is a TauriMockInstance
   * @example
   * ```js
   * // Check by command name
   * if (await browser.tauri.isMockFunction('read_clipboard')) {
   *   // read_clipboard is mocked
   * }
   *
   * // Check by function object
   * const mock = await browser.tauri.mock('read_clipboard');
   * if (browser.tauri.isMockFunction(mock)) {
   *   // mock is a TauriMockInstance
   *   expect(mock.mock.calls).toHaveLength(1);
   * }
   * ```
   */
  isMockFunction: (commandOrFn: unknown) => boolean;

  /**
   * Mock a Tauri backend command.
   *
   * @param command - Name of the Tauri command to mock
   * @returns Promise that resolves to the mock
   *
   * @example
   * ```js
   * const mock = await browser.tauri.mock('read_clipboard');
   * await mock.mockReturnValue('mocked clipboard content');
   * ```
   */
  mock: (command: string) => Promise<TauriMock>;

  /**
   * Clear all Tauri API mocks.
   *
   * @param commandPrefix - Optional command name prefix to filter which mocks to clear.
   *                        If provided, only mocks with command names starting with this prefix will be cleared.
   *                        If omitted, all mocks will be cleared.
   * @example
   * ```js
   * // Clear all mocks
   * await browser.tauri.clearAllMocks();
   *
   * // Clear only clipboard-related mocks
   * await browser.tauri.clearAllMocks('clipboard');
   * ```
   */
  clearAllMocks: (commandPrefix?: string) => Promise<void>;

  /**
   * Reset all Tauri API mocks.
   *
   * @param commandPrefix - Optional command name prefix to filter which mocks to reset.
   *                        If provided, only mocks with command names starting with this prefix will be reset.
   *                        If omitted, all mocks will be reset.
   */
  resetAllMocks: (commandPrefix?: string) => Promise<void>;

  /**
   * Restore all Tauri API mocks.
   *
   * @param commandPrefix - Optional command name prefix to filter which mocks to restore.
   *                        If provided, only mocks with command names starting with this prefix will be restored.
   *                        If omitted, all mocks will be restored.
   */
  restoreAllMocks: (commandPrefix?: string) => Promise<void>;

  /**
   * Trigger a deeplink to the Tauri application for testing protocol handlers.
   *
   * @param url - The deeplink URL to trigger (e.g., 'myapp://open?path=/test')
   * @returns Promise that resolves when the deeplink has been triggered
   *
   * @example
   * ```js
   * await browser.tauri.triggerDeeplink('myapp://open?file=test.txt');
   * ```
   */
  triggerDeeplink: (url: string) => Promise<void>;

  /**
   * Switch the active Tauri window for subsequent operations.
   * Changes the window that browser.tauri.execute() and other
   * Tauri-specific operations target.
   *
   * @param label - The window label to switch to (e.g., 'main', 'settings')
   * @returns Promise that resolves when the window switch is complete
   *
   * @example
   * ```js
   * await browser.tauri.switchWindow('settings');
   * const result = await browser.tauri.execute(({ core }) => core.invoke('get_data'));
   * ```
   */
  switchWindow: (label: string) => Promise<void>;

  /**
   * Get a list of all available Tauri window labels.
   *
   * @returns Promise that resolves to an array of window label strings
   *
   * @example
   * ```js
   * const windows = await browser.tauri.listWindows();
   * console.log(windows); // ['main', 'settings']
   * ```
   */
  listWindows: () => Promise<string[]>;

  /**
   * Emit a Tauri event from the test process to listeners registered in the frontend
   * via `listen()` / `once()` from `@tauri-apps/api/event`.
   *
   * Works in both modes:
   * - Browser mode: routes through the in-browser listener registry
   * - Native mode: routes through the real Tauri `event.emit()` / `event.emitTo()` via the backend
   *
   * @param event - Event name to emit (e.g. `'data-loaded'`)
   * @param payload - Optional event payload (JSON-serialised across the boundary)
   * @param target - Optional target filter — string is treated as `{ kind: 'AnyLabel', label }`,
   *                 or pass an explicit `TauriEventTarget`. Omit to emit to all subscribers.
   *
   * @example
   * ```js
   * // Frontend: const unlisten = await listen('data-loaded', (e) => updateUI(e.payload));
   * await browser.tauri.emitEvent('data-loaded', { rows: 3 });
   *
   * // Targeted emit — only listeners that subscribed with target: 'main' fire
   * await browser.tauri.emitEvent('focus-window', undefined, 'main');
   * ```
   */
  emitEvent: <T = unknown>(event: string, payload?: T, target?: string | TauriEventTarget) => Promise<void>;
}

/**
 * The options for the Tauri Service.
 * Extends base service options with Tauri-specific configuration.
 */
export interface TauriServiceOptions extends BaseServiceOptions, DriverProviderConfig {
  /**
   * Run mode for the Tauri service.
   * - 'native': default; requires a built Tauri binary and tauri-driver.
   * - 'browser': runs the frontend in plain Chrome against a Vite dev server with Tauri IPC intercepted at the JS boundary. No binary or native driver required.
   * @default 'native'
   */
  mode?: 'native' | 'browser';
  /**
   * URL of the Vite dev server to navigate to when mode is 'browser'.
   * Required when mode === 'browser'. e.g. 'http://localhost:1420'
   */
  devServerUrl?: string;
  /**
   * The port for tauri-driver to listen on.
   */
  tauriDriverPort?: number;
  /**
   * The path to the tauri-driver executable.
   */
  tauriDriverPath?: string;
  /**
   * Log level for tauri-driver.
   */
  logLevel?: LogLevel;
  /**
   * Path to @crabnebula/tauri-driver executable
   * If not provided, will be auto-detected from node_modules
   */
  crabnebulaDriverPath?: string;
  /**
   * Auto-manage test-runner-backend process (macOS only)
   * Required for macOS testing with CrabNebula
   * @default true when driverProvider is 'crabnebula' and platform is darwin
   */
  crabnebulaManageBackend?: boolean;
  /**
   * Port for test-runner-backend (macOS only)
   * @default 3000
   */
  crabnebulaBackendPort?: number;
  /**
   * Default window label for Tauri operations.
   * Controls which webview window browser.tauri.execute() and other
   * Tauri-specific operations target by default.
   * Can be overridden at runtime with browser.tauri.switchWindow()
   * or per-call with browser.tauri.execute(script, args, { windowLabel }).
   * @default 'main'
   */
  windowLabel?: string;
}

/**
 * Tauri service global options
 * Extends base global options with Tauri-specific configuration
 */
export interface TauriServiceGlobalOptions extends BaseServiceGlobalOptions, DriverProviderConfig {
  mode?: 'native' | 'browser';
  devServerUrl?: string;
  logLevel?: LogLevel;
  tauriDriverPort?: number;
  nativeDriverPath?: string;
  /**
   * Path to @crabnebula/tauri-driver executable
   * If not provided, will be auto-detected from node_modules
   */
  crabnebulaDriverPath?: string;
  /**
   * Auto-manage test-runner-backend process (macOS only)
   * Required for macOS testing with CrabNebula
   * @default true when driverProvider is 'crabnebula' and platform is darwin
   */
  crabnebulaManageBackend?: boolean;
  /**
   * Port for test-runner-backend (macOS only)
   * @default 3000
   */
  crabnebulaBackendPort?: number;
  /**
   * Default window label for Tauri operations.
   * @default 'main'
   */
  windowLabel?: string;
}

/**
 * Tauri service result type
 * Uses the standard Result pattern: check `result.ok`, then access `result.value` or `result.error`
 */
export type TauriResult<T = unknown> = Result<T, string>;

/**
 * Tauri service capabilities
 */
export interface TauriServiceCapabilities {
  browserName?: 'tauri';
  'tauri:options'?: {
    application: string;
    args?: string[];
    webviewOptions?: {
      width?: number;
      height?: number;
    };
  };
  'wdio:tauriServiceOptions'?: TauriServiceOptions;
}

type TauriServiceRequestedStandaloneCapabilities = Capabilities.RequestedStandaloneCapabilities &
  TauriServiceCapabilities;
type TauriServiceRequestedMultiremoteCapabilities = Capabilities.RequestedMultiremoteCapabilities &
  TauriServiceCapabilities;

export type TauriServiceCapabilitiesType =
  | TauriServiceRequestedStandaloneCapabilities[]
  | TauriServiceRequestedMultiremoteCapabilities
  | TauriServiceRequestedMultiremoteCapabilities[];

export type WdioTauriConfig = Options.Testrunner & {
  capabilities: TauriServiceCapabilitiesType | TauriServiceCapabilitiesType[];
};

type TauriServiceCustomCapability = {
  /**
   * custom capabilities to configure the Tauri service
   */
  'wdio:tauriServiceOptions'?: TauriServiceOptions;
};

/**
 * Browser extension for Tauri service
 */
export interface TauriBrowserExtension extends BrowserBase {
  /**
   * Access the WebdriverIO Tauri Service API.
   *
   * - {@link TauriServiceAPI.clearAllMocks `browser.tauri.clearAllMocks`} - Clear the Tauri API mock functions
   * - {@link TauriServiceAPI.emitEvent `browser.tauri.emitEvent`} - Emit a Tauri event to frontend listeners
   * - {@link TauriServiceAPI.execute `browser.tauri.execute`} - Execute code in the Tauri frontend context
   * - {@link TauriServiceAPI.isMockFunction `browser.tauri.isMockFunction`} - Check if a value is a Tauri mock or a command is mocked
   * - {@link TauriServiceAPI.listWindows `browser.tauri.listWindows`} - List the labels of all open windows
   * - {@link TauriServiceAPI.mock `browser.tauri.mock`} - Mock a function from the Tauri API
   * - {@link TauriServiceAPI.resetAllMocks `browser.tauri.resetAllMocks`} - Reset the Tauri API mock functions
   * - {@link TauriServiceAPI.restoreAllMocks `browser.tauri.restoreAllMocks`} - Restore the original Tauri API functionality
   * - {@link TauriServiceAPI.switchWindow `browser.tauri.switchWindow`} - Switch WebDriver focus to another window
   * - {@link TauriServiceAPI.triggerDeeplink `browser.tauri.triggerDeeplink`} - Trigger a deeplink for testing protocol handlers
   */
  tauri: TauriServiceAPI;
}

// Re-export the custom capability for external use
export type { TauriServiceCustomCapability };

// ============================================================================
// Tauri Capabilities (for WDIO configuration)
// ============================================================================

/**
 * Tauri capabilities for WebdriverIO configuration
 * This interface is used in wdio.conf.ts to type the capabilities array
 */
export interface TauriCapabilities extends WebdriverIO.Capabilities {
  browserName?: 'tauri' | 'wry';
  'tauri:options'?: {
    application: string;
    args?: string[];
    webviewOptions?: {
      width?: number;
      height?: number;
    };
  };
  'wdio:tauriServiceOptions'?: TauriServiceOptions;
}

// ============================================================================
// Global Window Augmentation
// ============================================================================

declare global {
  /**
   * Tauri APIs available on window.__TAURI__
   */
  interface Window {
    /**
     * Tauri global API object
     */
    __TAURI__?: {
      core?: {
        invoke?: (cmd: string, args?: unknown) => Promise<unknown>;
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
  }
}
