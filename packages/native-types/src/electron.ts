import type { OfficialArch } from '@electron/packager';
import type { ForgeConfig as ElectronForgeConfig } from '@electron-forge/shared-types';
import type { Mock, MockResultType, fn as vitestFn } from '@wdio/native-spy';
import type { Capabilities, Options } from '@wdio/types';
import type { ArchType } from 'builder-util';
import type * as Electron from 'electron';

import type { NormalizedPackageJson } from './package.js';

export type PackageJson = NormalizedPackageJson;

import type {
  AbstractFn,
  BaseServiceGlobalOptions,
  BaseServiceOptions,
  BrowserBase,
  LogLevel,
  MockOverride,
  ServiceMockContext,
} from './shared.js';

// ============================================================================
// Electron-Specific Types
// ============================================================================

export type ElectronApiFn = ElectronType[ElectronInterface][keyof ElectronType[ElectronInterface]];

export interface ElectronServiceAPI {
  /**
   * The window handle of the Electron window.
   */
  windowHandle?: string;
  /**
   * Mock a function from the Electron API.
   *
   * @param apiName name of the API to mock
   * @param funcName name of the function to mock
   * @param mockReturnValue value to return when the mocked function is called
   * @returns a {@link Promise} that resolves once the mock is registered
   */
  mock: {
    (className: string): Promise<ElectronClassMock>;
    (apiName: string, funcName: string, returnValue?: unknown): Promise<ElectronFunctionMock>;
  };
  /**
   * Mock all functions from an Electron API.
   *
   * @param apiName name of the API to mock
   * @returns a {@link Promise} that resolves once the mock is registered
   */
  mockAll: <Interface extends ElectronInterface>(apiName: Interface) => Promise<Record<string, ElectronMock>>;
  /**
   * Execute a function within the Electron main process.
   *
   * @param script function to execute
   * @param args function arguments
   */
  execute<ReturnValue, InnerArguments extends unknown[]>(
    script: string | ((electron: typeof Electron, ...innerArgs: InnerArguments) => ReturnValue),
    ...args: InnerArguments
  ): Promise<ReturnValue>;
  /**
   * Clear mocked Electron API function(s).
   *
   * @param apiName mocked api to clear
   */
  clearAllMocks: (apiName?: string) => Promise<void>;
  /**
   * Reset mocked Electron API function(s).
   *
   * @param apiName mocked api to reset
   */
  resetAllMocks: (apiName?: string) => Promise<void>;
  /**
   * Restore mocked Electron API function(s).
   *
   * @param apiName mocked api to remove
   */
  restoreAllMocks: (apiName?: string) => Promise<void>;
  /**
   * Checks that a given parameter is an Electron mock function. If you are using TypeScript, it will also narrow down its type.
   */
  isMockFunction: (fn: unknown) => fn is ElectronMockInstance;
  /**
   * Trigger a deeplink to the Electron application for testing protocol handlers.
   *
   * On Windows, this automatically appends the test instance's user-data-dir to ensure
   * the deeplink reaches the correct instance. On macOS and Linux, it works transparently.
   *
   * The app must implement protocol handler registration via `app.setAsDefaultProtocolClient()`
   * and single instance lock via `app.requestSingleInstanceLock()`. On Windows, the app must
   * also parse the userData query parameter and call `app.setPath('userData', userDataDir)`
   * early in startup.
   *
   * @param url - The deeplink URL to trigger (e.g., 'myapp://test')
   * @returns a Promise that resolves when the deeplink has been triggered
   * @throws Error if appBinaryPath is not configured (Windows only)
   * @throws Error if the URL is invalid or uses http/https/file protocols
   *
   * @example
   * ```ts
   * // Trigger a simple deeplink
   * await browser.electron.triggerDeeplink('myapp://open?path=/test');
   *
   * // Wait for app to process the deeplink
   * await browser.waitUntil(async () => {
   *   const openedPath = await browser.electron.execute(() => {
   *     return globalThis.lastOpenedPath;
   *   });
   *   return openedPath === '/test';
   * });
   * ```
   */
  triggerDeeplink: (url: string) => Promise<void>;
}

/**
 * Fields from BaseServiceOptions that are not consumed by the Electron service.
 * Captured here so the Omit list stays in sync with the documented surface.
 */
type ElectronUnsupportedBaseOptions =
  | 'commandTimeout'
  | 'startTimeout'
  | 'captureBackendLogs'
  | 'captureFrontendLogs'
  | 'backendLogLevel'
  | 'frontendLogLevel'
  | 'clearMocksPrefix'
  | 'resetMocksPrefix'
  | 'restoreMocksPrefix';

/**
 * The options for the Electron Service.
 * Extends base service options with Electron-specific configuration.
 */
export interface ElectronServiceOptions extends Omit<BaseServiceOptions, ElectronUnsupportedBaseOptions> {
  /**
   * The path to the electron entry point of the app for testing.
   */
  appEntryPoint?: string;
  /**
   * Enable capture of main process console logs via CDP
   * @default false
   */
  captureMainProcessLogs?: boolean;
  /**
   * Enable capture of renderer process console logs via CDP
   * @default false
   */
  captureRendererLogs?: boolean;
  /**
   * Minimum log level for main process logs
   * @default 'info'
   */
  mainProcessLogLevel?: LogLevel;
  /**
   * Minimum log level for renderer process logs
   * @default 'info'
   */
  rendererLogLevel?: LogLevel;
  /**
   * Directory for standalone mode logs (when WDIO runner not available)
   * @default './logs'
   */
  logDir?: string;
  /**
   * Auto-install AppArmor profiles on Linux systems that require them
   * @default false
   */
  apparmorAutoInstall?: boolean | 'sudo';
  /**
   * Path to a custom electron-builder configuration file (relative to project root).
   * Useful when you have multiple configs (e.g., staging, production) that extend
   * a common base config.
   * @example 'config/electron-builder-staging.config.js'
   */
  electronBuilderConfig?: string;
  /**
   * Run mode for the Electron service.
   * 'browser' runs the frontend in plain Chrome against a dev server with IPC intercepted
   * at the JS boundary. No Electron binary, no CDP bridge, no display server required.
   * @default 'native'
   */
  mode?: 'native' | 'browser';
  /**
   * URL of the Vite (or other) dev server to navigate to when mode is 'browser'.
   * Required when mode === 'browser'. e.g. 'http://localhost:5173'
   */
  devServerUrl?: string;
}

/**
 * Global options for the Electron Service
 * Extends base global options with Electron-specific configuration
 */
export interface ElectronServiceGlobalOptions
  extends Omit<
    BaseServiceGlobalOptions,
    | 'captureBackendLogs'
    | 'captureFrontendLogs'
    | 'backendLogLevel'
    | 'frontendLogLevel'
    | 'clearMocksPrefix'
    | 'resetMocksPrefix'
    | 'restoreMocksPrefix'
  > {
  /**
   * The path to the electron binary of the app for testing.
   */
  appBinaryPath?: string;
  /**
   * The path to the electron entry point of the app for testing.
   */
  appEntryPoint?: string;
  /**
   * Directory for standalone mode logs (when WDIO runner not available)
   * @default './logs'
   */
  logDir?: string;
  /**
   * Path to a custom electron-builder configuration file (relative to project root).
   */
  electronBuilderConfig?: string;
  /**
   * Enable capture of main process console logs via CDP
   * @default false
   */
  captureMainProcessLogs?: boolean;
  /**
   * Enable capture of renderer process console logs via CDP
   * @default false
   */
  captureRendererLogs?: boolean;
  /**
   * Minimum log level for main process logs
   * @default 'info'
   */
  mainProcessLogLevel?: LogLevel;
  /**
   * Minimum log level for renderer process logs
   * @default 'info'
   */
  rendererLogLevel?: LogLevel;
  /**
   * Timeout for any request using CdpBridge to a node debugger.
   */
  cdpBridgeTimeout?: number;
  /**
   * Interval in milliseconds to wait between attempts to connect to the node debugger.
   */
  cdpBridgeWaitInterval?: number;
  /**
   * Number of attempts to connect to the node debugger before giving up.
   */
  cdpBridgeRetryCount?: number;
  /**
   * Control automatic installation of AppArmor profiles on Linux if needed.
   * @default false
   */
  apparmorAutoInstall?: boolean | 'sudo';
  /**
   * Run mode for the Electron service.
   * 'browser' skips binary detection, CDP bridge, and Chromedriver setup.
   * @default 'native'
   */
  mode?: 'native' | 'browser';
  /**
   * URL of the dev server to navigate to when mode is 'browser'.
   * Required when mode === 'browser'. e.g. 'http://localhost:5173'
   */
  devServerUrl?: string;
}

export type ApiCommand = { name: string; bridgeProp: string };
export type WebdriverClientFunc = (this: WebdriverIO.Browser, ...args: unknown[]) => Promise<unknown>;

export type ElectronType = typeof Electron;
export type ElectronInterface = keyof ElectronType;

export type BuilderConfig = {
  extends?: string | string[] | null;
  productName?: string;
  directories?: { output?: string };
  executableName?: string;
};

export type ForgeConfig = ElectronForgeConfig;

export type BuilderArch = ArchType;
export type ForgeArch = OfficialArch;

export type ForgeBuildInfo = {
  appName: string;
  config: ForgeConfig;
  isBuilder: false;
  isForge: true;
};

export type BuilderBuildInfo = {
  appName: string;
  config: BuilderConfig;
  isBuilder: true;
  isForge: false;
};

export type AppBuildInfo = ForgeBuildInfo | BuilderBuildInfo;

// Binary Path Result Types
export type PathGenerationErrorType =
  | 'CONFIG_MISSING'
  | 'CONFIG_INVALID'
  | 'CONFIG_WARNING'
  | 'MULTIPLE_BUILD_TOOLS'
  | 'NO_BUILD_TOOL'
  | 'UNSUPPORTED_PLATFORM';

export type PathValidationErrorType =
  | 'FILE_NOT_FOUND'
  | 'NOT_EXECUTABLE'
  | 'PERMISSION_DENIED'
  | 'IS_DIRECTORY'
  | 'ACCESS_ERROR';

export interface PathGenerationError {
  type: PathGenerationErrorType;
  message: string;
  buildTool?: string;
  details?: string;
}

export interface PathValidationError {
  type: PathValidationErrorType;
  message: string;
  code?: string;
  permissions?: string;
  details?: string;
}

export interface PathValidationAttempt {
  path: string;
  valid: boolean;
  error?: PathValidationError;
}

/**
 * Path generation result using standard Result pattern
 * Check `result.ok` to determine success, then access `result.value` or `result.error`
 */
export type PathGenerationResult =
  | { ok: true; value: { paths: string[]; warnings?: PathGenerationError[] } }
  | { ok: false; error: { errors: PathGenerationError[] } };

/**
 * Path validation result using standard Result pattern
 * Check `result.ok` to determine success, then access `result.value` or `result.error`
 */
export type PathValidationResult =
  | { ok: true; value: { validPath: string; attempts: PathValidationAttempt[] } }
  | { ok: false; error: { attempts: PathValidationAttempt[] } };

/**
 * Binary path resolution result using standard Result pattern
 * Check `result.ok` to determine success, then access `result.value` or `result.error`
 */
export type BinaryPathResult =
  | {
      ok: true;
      value: { binaryPath: string; pathGeneration: PathGenerationResult; pathValidation: PathValidationResult };
    }
  | { ok: false; error: { pathGeneration: PathGenerationResult; pathValidation: PathValidationResult } };

export type ExecuteOpts = {
  internal?: boolean;
};

export type WdioElectronWindowObj = {
  execute: (script: string, args?: unknown[]) => unknown;
};

type ElectronMockResult = {
  type: MockResultType;
  value: unknown;
};

interface ElectronMockContext extends ServiceMockContext {
  results: ElectronMockResult[];
}

export interface ElectronMockInstance extends Omit<Mock, MockOverride> {
  mockImplementation(fn: AbstractFn): Promise<ElectronFunctionMock>;
  mockImplementationOnce(fn: AbstractFn): Promise<ElectronFunctionMock>;
  mockReturnValue(obj: unknown): Promise<ElectronFunctionMock>;
  mockReturnValueOnce(obj: unknown): Promise<ElectronFunctionMock>;
  mockResolvedValue(obj: unknown): Promise<ElectronFunctionMock>;
  mockResolvedValueOnce(obj: unknown): Promise<ElectronFunctionMock>;
  mockRejectedValue(obj: unknown): Promise<ElectronFunctionMock>;
  mockRejectedValueOnce(obj: unknown): Promise<ElectronFunctionMock>;
  mockClear(): Promise<ElectronFunctionMock>;
  mockReset(): Promise<ElectronFunctionMock>;
  mockRestore(): Promise<ElectronFunctionMock>;
  mockReturnThis(): Promise<unknown>;
  withImplementation<ReturnValue, InnerArguments extends unknown[]>(
    implFn: AbstractFn,
    callbackFn: (electron: typeof Electron, ...innerArgs: InnerArguments) => ReturnValue,
  ): Promise<unknown>;
  mockName(name: string): ElectronFunctionMock;
  getMockName(): string;
  getMockImplementation(): AbstractFn;
  update(): Promise<ElectronFunctionMock>;
  mock: ElectronMockContext;
  __isElectronMock: boolean;
}

/**
 * Type for a mocked Electron class (e.g. `Tray`, `BrowserWindow`).
 *
 * The intersection design intentionally separates the well-known lifecycle
 * members from the dynamic per-method mocks:
 *
 * - The object literal on the left side gives precise return types for
 *   `__constructor`, `mockRestore`, and `getMockName` — which every class
 *   mock exposes regardless of which class was mocked.
 * - `& Record<string, ElectronFunctionMock>` on the right side lets callers
 *   index by any method name (e.g. `mock.setTitle`) and get back
 *   `ElectronFunctionMock` without TypeScript complaining about an unknown key.
 *
 * An interface with an index signature would require every named property to be
 * assignable to the index value type, which breaks for `mockRestore` and
 * `getMockName` (their return types differ from `ElectronFunctionMock`).
 * The intersection avoids that constraint while still providing typed dynamic
 * access.
 */
export type ElectronClassMock = {
  __constructor: ElectronFunctionMock;
  mockRestore: () => Promise<void>;
  getMockName: () => string;
} & Record<string, ElectronFunctionMock>;

export interface ElectronFunctionMock<TArgs extends unknown[] = unknown[], TReturns = unknown>
  extends ElectronMockInstance {
  new (...args: TArgs): TReturns;
  (...args: TArgs): TReturns;
}

// Union type for any Electron mock (function or class)
export type ElectronMock = ElectronFunctionMock | ElectronClassMock;

type ElectronServiceCustomCapability = {
  /**
   * custom capabilities to configure the Electron service
   */
  'wdio:electronServiceOptions'?: ElectronServiceOptions;
  /**
   * Chromium version for chromedriver fallback sources (automatically set by service)
   */
  'wdio:chromiumVersion'?: string;
};

type ElectronServiceRequestedStandaloneCapabilities = Capabilities.RequestedStandaloneCapabilities &
  ElectronServiceCustomCapability;
type ElectronServiceRequestedMultiremoteCapabilities = Capabilities.RequestedMultiremoteCapabilities &
  ElectronServiceCustomCapability;

export type ElectronServiceCapabilities =
  | ElectronServiceRequestedStandaloneCapabilities[]
  | ElectronServiceRequestedMultiremoteCapabilities
  | ElectronServiceRequestedMultiremoteCapabilities[];

export interface ElectronStandaloneCapability {
  browserName: 'electron';
  'goog:chromeOptions'?: { binary?: string; args?: string[] };
  'wdio:electronServiceOptions'?: ElectronServiceOptions;
  'wdio:chromiumVersion'?: string;
}

export type WdioElectronConfig = Omit<Options.Testrunner, 'capabilities'> & {
  capabilities: ElectronServiceCapabilities | ElectronServiceCapabilities[];
};

/**
 * Browser extension for Electron service
 */
export interface ElectronBrowserExtension extends BrowserBase {
  /**
   * Access the WebdriverIO Electron Service API.
   *
   * - {@link ElectronServiceAPI.clearAllMocks `browser.electron.clearAllMocks`} - Clear the Electron API mock functions
   * - {@link ElectronServiceAPI.execute `browser.electron.execute`} - Execute code in the Electron main process context
   * - {@link ElectronServiceAPI.isMockFunction `browser.electron.isMockFunction`} - Check if a function is an Electron mock
   * - {@link ElectronServiceAPI.mock `browser.electron.mock`} - Mock a function from the Electron API, e.g. `dialog.showOpenDialog`
   * - {@link ElectronServiceAPI.mockAll `browser.electron.mockAll`} - Mock an entire API object of the Electron API, e.g. `app` or `dialog`
   * - {@link ElectronServiceAPI.resetAllMocks `browser.electron.resetAllMocks`} - Reset the Electron API mock functions
   * - {@link ElectronServiceAPI.restoreAllMocks `browser.electron.restoreAllMocks`} - Restore the original Electron API functionality
   * - {@link ElectronServiceAPI.triggerDeeplink `browser.electron.triggerDeeplink`} - Trigger a deeplink to test protocol handlers
   * - {@link ElectronServiceAPI.windowHandle `browser.electron.windowHandle`} - Get the current window handle
   */
  electron: ElectronServiceAPI;
}

// Re-export types needed for global declarations
export type { Electron, vitestFn };
