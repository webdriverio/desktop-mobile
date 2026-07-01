import type { MockResult } from '@wdio/native-spy';
import type { ChainablePromiseArray, ChainablePromiseElement } from 'webdriverio';

// ============================================================================
// Shared Base Types
// ============================================================================

export type Fn = (...args: unknown[]) => unknown;
export type AsyncFn = (...args: unknown[]) => Promise<unknown>;
export type AbstractFn = Fn | AsyncFn;

type $ = (selector: unknown) => ChainablePromiseElement;
type $$ = (selector: unknown) => ChainablePromiseArray;

type SelectorsBase = {
  $: $;
  $$: $$;
};

type BaseWithExecute = {
  execute<T>(script: string | ((...args: unknown[]) => T), ...args: unknown[]): Promise<T>;
  execute<T>(script: string | ((...args: unknown[]) => T), ...args: unknown[]): T;
  executeAsync(script: string | ((...args: unknown[]) => void), ...args: unknown[]): unknown;
};

type ElementBase = SelectorsBase & {
  parent: ElementBase | BaseWithExecute;
};

type BrowserBase = SelectorsBase & {
  addCommand<T extends boolean>(
    queryName: string,
    commandFn: (this: T extends true ? ElementBase : BrowserBase, ...args: unknown[]) => void,
    isElementCommand?: T,
  ): unknown;
};

export type { BaseWithExecute, BrowserBase, ElementBase, SelectorsBase };

// ============================================================================
// Shared Mock Infrastructure
// ============================================================================

/**
 * Mock result type - re-exported from native-spy for consistency
 */
export type { MockResult, MockResultType } from '@wdio/native-spy';

/**
 * Service mock context - shared between Electron and Tauri mocking
 * Tracks mock call history and results at the service level
 */
export interface ServiceMockContext {
  /**
   * This is an array containing all arguments for each call. Each item of the array is the arguments of that call.
   */
  calls: unknown[][];
  /**
   * The order of mock invocation. This returns an array of numbers that are shared between all defined mocks. Will return an empty array if the mock was never invoked.
   */
  invocationCallOrder: number[];
  /**
   * This is an array containing all values that were returned from the mock. Each item of the array is an object with the properties type and value.
   */
  results: MockResult[];
  /**
   * This contains the arguments of the last call. If the mock wasn't called, it will return `undefined`.
   */
  lastCall: unknown;
}

/**
 * Override types for mock methods
 */
export type MockOverride =
  | 'mockImplementation'
  | 'mockImplementationOnce'
  | 'mockReturnValue'
  | 'mockReturnValueOnce'
  | 'mockResolvedValue'
  | 'mockResolvedValueOnce'
  | 'mockRejectedValue'
  | 'mockRejectedValueOnce'
  | 'mockClear'
  | 'mockReset'
  | 'mockRestore'
  | 'mockReturnThis'
  | 'mockName'
  | 'withImplementation'
  | 'mock';

// ============================================================================
// Shared Logging Types
// ============================================================================

/**
 * Log level used across services
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

// ============================================================================
// Shared Service Configuration Types
// ============================================================================

/**
 * Driver provider configuration - shared between Electron, Tauri, and Dioxus services
 */
export interface DriverProviderConfig {
  /**
   * Driver provider to use for WebDriver communication
   * - 'external': Use an external driver process (cargo-installed tauri-driver,
   *   electron-chromedriver, or wdio-dioxus-driver)
   * - 'official': Deprecated synonym for 'external'. Accepted with a warning
   *   for one release cycle, removed in v2.
   * - 'crabnebula': Use @crabnebula/tauri-driver from npm (Tauri only, enables macOS support)
   * - 'embedded': Use embedded WebDriver server via plugin (no external driver needed)
   * @default 'external'
   */
  driverProvider?: 'external' | 'official' | 'crabnebula' | 'embedded';
  /**
   * Port for embedded WebDriver server (when driverProvider is 'embedded')
   * Can be overridden via environment variable (TAURI_WEBDRIVER_PORT or WDIO_EMBEDDED_PORT)
   * @default 4445
   */
  embeddedPort?: number;
}

/**
 * Log capture configuration - shared between Electron and Tauri services
 */
export interface LogCaptureConfig {
  /**
   * Enable/disable capturing backend logs from stdout
   * @default false
   */
  captureBackendLogs?: boolean;
  /**
   * Enable/disable capturing frontend console logs from webview
   * @default false
   */
  captureFrontendLogs?: boolean;
  /**
   * Minimum log level for backend logs (only logs at this level and above will be captured)
   * @default 'info'
   */
  backendLogLevel?: LogLevel;
  /**
   * Minimum log level for frontend logs (only logs at this level and above will be captured)
   * @default 'info'
   */
  frontendLogLevel?: LogLevel;
}

/**
 * Mock lifecycle configuration - shared between Electron and Tauri services
 */
export interface MockLifecycleConfig {
  /**
   * If true, all mock call history will be cleared before each test.
   * Equivalent to calling `clearAllMocks()` before each test.
   * @default false
   */
  clearMocks?: boolean;
  /**
   * Optional prefix to filter which mocks to clear before each test.
   * Only used when clearMocks is true.
   * @default undefined
   */
  clearMocksPrefix?: string;
  /**
   * If true, all mocks will be reset (implementation + history) before each test.
   * Equivalent to calling `resetAllMocks()` before each test.
   * @default false
   */
  resetMocks?: boolean;
  /**
   * Optional prefix to filter which mocks to reset before each test.
   * Only used when resetMocks is true.
   * @default undefined
   */
  resetMocksPrefix?: string;
  /**
   * If true, all mocks will be restored to their original implementations before each test.
   * Equivalent to calling `restoreAllMocks()` before each test.
   * @default false
   */
  restoreMocks?: boolean;
  /**
   * Optional prefix to filter which mocks to restore before each test.
   * Only used when restoreMocks is true.
   * @default undefined
   */
  restoreMocksPrefix?: string;
}

/**
 * Object form of {@link DevServer} — the command to spawn plus its environment and readiness knobs.
 */
export interface DevServerObject {
  /** Command run in a shell to start the dev server, e.g. `'pnpm dev'`. */
  command: string;
  /** Working directory for the command. Default `process.cwd()`. */
  cwd?: string;
  /** Extra environment variables, merged over `process.env`. */
  env?: Record<string, string>;
  /** Readiness timeout in ms (how long to wait for `devServerUrl`). Default 60000 (120000 in CI). */
  timeoutMs?: number;
  /**
   * Reuse a server already reachable at `devServerUrl` instead of spawning a new one.
   * @default true locally, false in CI (`!process.env.CI`)
   */
  reuseExistingServer?: boolean;
}

/**
 * Optional dev-server management for browser mode. When set, the service spawns the dev server in
 * `onPrepare`, waits until `devServerUrl` is reachable, and tears it down on completion / failure.
 *
 * - `string` — a shell command, e.g. `'pnpm dev'`.
 * - {@link DevServerObject} — the command plus `cwd` / `env` / `timeoutMs` / `reuseExistingServer`.
 * - function — start the server yourself and return `{ url, close }`; the returned `url` supplies or
 *   overrides `devServerUrl`, and `close` is the teardown (no subprocess/child-kill involved).
 */
export type DevServer = string | DevServerObject | (() => Promise<{ url: string; close: () => Promise<void> }>);

/**
 * Base service options shared between Electron and Tauri
 */
export interface BaseServiceOptions extends LogCaptureConfig, MockLifecycleConfig {
  /**
   * Auto-manage the dev server in browser mode (spawn in `onPrepare`, wait for `devServerUrl`,
   * tear down on completion). Ignored outside browser mode.
   */
  devServer?: DevServer;
  /**
   * The path to the application binary for testing
   */
  appBinaryPath?: string;
  /**
   * An array of string arguments to be passed through to the app on execution
   */
  appArgs?: string[];
  /**
   * Timeout for command execution (in milliseconds)
   * @default 30000
   */
  commandTimeout?: number;
  /**
   * Timeout for app startup (in milliseconds)
   * @default 60000
   */
  startTimeout?: number;
}

/**
 * Base global options shared between Electron and Tauri services
 */
export interface BaseServiceGlobalOptions extends LogCaptureConfig, MockLifecycleConfig {
  /**
   * Root directory of the project
   */
  rootDir?: string;
  /**
   * Auto-manage the dev server in browser mode (spawn in `onPrepare`, wait for `devServerUrl`,
   * tear down on completion). Ignored outside browser mode.
   */
  devServer?: DevServer;
}

// ============================================================================
// Shared Utility Types
// ============================================================================

/**
 * Result type for operations that can fail
 * Use `result.ok` to check success, then `result.value` or `result.error` to access
 */
export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };
