import type { Mock } from '@wdio/native-spy';
import type { Capabilities, Options } from '@wdio/types';
import type {
  AbstractFn,
  BrowserBase,
  LogCaptureConfig,
  MockLifecycleConfig,
  MockOverride,
  Result,
  ServiceMockContext,
} from './shared.js';

// ============================================================================
// React Native-Specific Types
// ============================================================================

/**
 * The React Native JS realm surface handed to `browser.reactNative.execute()`
 * callbacks. Code runs in the app's own Hermes global (`globalThis`), so the
 * shape is intentionally open — known RN globals are typed for convenience and
 * an index signature keeps arbitrary realm access available.
 */
export interface ReactNativeAPIs {
  /** RN's native-module proxy (TurboModules / legacy bridge), reachable in the Hermes realm. */
  nativeModuleProxy?: Record<string, unknown>;
  /** Present under Hermes; a truthy marker that the callback ran in the RN JS realm. */
  HermesInternal?: unknown;
  [key: string]: unknown;
}

/** React Native mock context — the shared {@link ServiceMockContext} as-is. */
type ReactNativeMockContext = ServiceMockContext;

/**
 * React Native mock instance interface
 */
export interface ReactNativeMockInstance extends Omit<Mock, MockOverride> {
  mockImplementation(fn: AbstractFn): Promise<ReactNativeMock>;
  mockImplementationOnce(fn: AbstractFn): Promise<ReactNativeMock>;
  mockReturnValue(obj: unknown): Promise<ReactNativeMock>;
  mockReturnValueOnce(obj: unknown): Promise<ReactNativeMock>;
  mockResolvedValue(obj: unknown): Promise<ReactNativeMock>;
  mockResolvedValueOnce(obj: unknown): Promise<ReactNativeMock>;
  mockRejectedValue(obj: unknown): Promise<ReactNativeMock>;
  mockRejectedValueOnce(obj: unknown): Promise<ReactNativeMock>;
  mockClear(): Promise<ReactNativeMock>;
  mockReset(): Promise<ReactNativeMock>;
  mockRestore(): Promise<ReactNativeMock>;
  mockReturnThis(): Promise<ReactNativeMock>;
  withImplementation<ReturnValue>(implFn: AbstractFn, callbackFn: () => ReturnValue): Promise<ReturnValue>;
  mockName(name: string): ReactNativeMock;
  getMockName(): string;
  getMockImplementation(): AbstractFn | undefined;
  update(): Promise<ReactNativeMock>;
  __isReactNativeMock: true;
  mock: ReactNativeMockContext;
}

/**
 * React Native mock function type
 */
export interface ReactNativeMock<TArgs extends unknown[] = unknown[], TReturns = unknown>
  extends ReactNativeMockInstance {
  new (...args: TArgs): TReturns;
  (...args: TArgs): TReturns;
}

/**
 * Options for browser.reactNative.execute() per-call overrides.
 * Use withExecuteOptions() from @wdio/react-native-service to create properly-typed options.
 */
export interface ReactNativeExecuteOptions {
  /**
   * Sentinel property - set automatically by withExecuteOptions()
   * @internal - do not set manually
   */
  __wdioOptions__: true;
}

/**
 * React Native Service API interface for the browser object.
 *
 * Mirrors the converged `browser.<framework>.*` surface of the desktop services;
 * `execute`/`mock` run in the app's Hermes JS realm over CDP (Metro inspector),
 * find/tap and the Appium-native pieces run over the W3C session. `switchWindow`/
 * `listWindows` are reinterpreted as Appium context switching (`NATIVE_APP` ↔
 * `WEBVIEW_*`).
 */
export interface ReactNativeServiceAPI {
  /**
   * Execute JavaScript in the app's Hermes JS realm with per-call options and arguments.
   *
   * Requires a debug/Metro build with the Hermes inspector reachable.
   *
   * @example
   * ```js
   * const value = await browser.reactNative.execute(
   *   (rn, key) => rn.nativeModuleProxy?.SettingsManager?.[key],
   *   { __wdioOptions__: true },
   *   'appTheme'
   * );
   * ```
   */
  execute<ReturnValue, InnerArguments extends unknown[]>(
    script: string | ((rn: ReactNativeAPIs, ...innerArgs: InnerArguments) => ReturnValue),
    options: ReactNativeExecuteOptions,
    ...args: InnerArguments
  ): Promise<ReturnValue>;

  /**
   * Execute JavaScript in the app's Hermes JS realm.
   *
   * @param script - Function to execute (receives the RN realm as first parameter) or string
   * @param args - Additional arguments passed to the script
   *
   * @example
   * ```js
   * const isHermes = await browser.reactNative.execute(() => typeof HermesInternal === 'object');
   * ```
   */
  execute<ReturnValue, InnerArguments extends unknown[]>(
    script: string | ((rn: ReactNativeAPIs, ...innerArgs: InnerArguments) => ReturnValue),
    ...args: InnerArguments
  ): Promise<ReturnValue>;

  /**
   * Check if a value is a React Native mock function, or if a target path is mocked.
   * Accepts either a mock function object or a target path string.
   *
   * @param targetOrFn - Target path (string) or mock function object to check
   * @returns True if the target is mocked or the value is a ReactNativeMockInstance
   */
  isMockFunction: (targetOrFn: unknown) => boolean;

  /**
   * Mock a function in the React Native JS realm by dotted path
   * (e.g. a native-module method on `nativeModuleProxy`).
   *
   * @param target - Dotted path of the function to mock in the Hermes global
   * @returns Promise that resolves to the mock
   *
   * @example
   * ```js
   * const mock = await browser.reactNative.mock('nativeModuleProxy.Clipboard.getString');
   * await mock.mockResolvedValue('mocked clipboard content');
   * ```
   */
  mock: (target: string) => Promise<ReactNativeMock>;

  /**
   * Clear all React Native mocks.
   *
   * @param targetPrefix - Optional target-path prefix to filter which mocks to clear.
   *                       If omitted, all mocks are cleared.
   */
  clearAllMocks: (targetPrefix?: string) => Promise<void>;

  /**
   * Reset all React Native mocks.
   *
   * @param targetPrefix - Optional target-path prefix to filter which mocks to reset.
   *                       If omitted, all mocks are reset.
   */
  resetAllMocks: (targetPrefix?: string) => Promise<void>;

  /**
   * Restore all React Native mocks to their original implementations.
   *
   * @param targetPrefix - Optional target-path prefix to filter which mocks to restore.
   *                       If omitted, all mocks are restored.
   */
  restoreAllMocks: (targetPrefix?: string) => Promise<void>;

  /**
   * Trigger a deeplink into the React Native application for testing `Linking` handlers.
   *
   * @param url - The deeplink URL to trigger (e.g., 'myapp://open?path=/test')
   * @returns Promise that resolves when the deeplink has been triggered
   *
   * @example
   * ```js
   * await browser.reactNative.triggerDeeplink('myapp://open?file=test.txt');
   * ```
   */
  triggerDeeplink: (url: string) => Promise<void>;

  /**
   * Switch the active Appium context (e.g. `NATIVE_APP` ↔ a `WEBVIEW_*`).
   *
   * The converged `switchWindow` of the desktop services, reinterpreted for
   * mobile: React Native "windows" are Appium contexts.
   *
   * @param context - The context name to switch to (e.g. 'NATIVE_APP', 'WEBVIEW_com.app')
   * @returns Promise that resolves when the context switch is complete
   *
   * @example
   * ```js
   * await browser.reactNative.switchWindow('NATIVE_APP');
   * ```
   */
  switchWindow: (context: string) => Promise<void>;

  /**
   * List the available Appium contexts (`NATIVE_APP` and any `WEBVIEW_*`).
   *
   * The converged `listWindows` of the desktop services, reinterpreted for
   * mobile contexts.
   *
   * @returns Promise that resolves to an array of context names
   *
   * @example
   * ```js
   * const contexts = await browser.reactNative.listWindows();
   * console.log(contexts); // ['NATIVE_APP', 'WEBVIEW_com.app']
   * ```
   */
  listWindows: () => Promise<string[]>;

  /**
   * Emit an event to listeners registered in the app via React Native's
   * `DeviceEventEmitter` (or `NativeEventEmitter`).
   *
   * @param event - Event name to emit (e.g. `'data-loaded'`)
   * @param payload - Optional event payload (JSON-serialised across the boundary)
   *
   * @example
   * ```js
   * // App: DeviceEventEmitter.addListener('data-loaded', (e) => updateUI(e));
   * await browser.reactNative.emitEvent('data-loaded', { rows: 3 });
   * ```
   */
  emitEvent: <T = unknown>(event: string, payload?: T) => Promise<void>;
}

/**
 * The options for the React Native Service.
 *
 * Unlike the desktop services, this does **not** extend `BaseServiceOptions`: a
 * React Native app is launched by Appium via capabilities (`appium:app` /
 * `appium:appPackage`+`appium:appActivity` / `appium:bundleId`), so the
 * desktop binary-launch fields (`appArgs`, startup/command timeouts) don't apply.
 * Only the shared log-capture + mock-lifecycle config and RN/Metro-specific
 * options are exposed.
 */
export interface ReactNativeServiceOptions extends LogCaptureConfig, MockLifecycleConfig {
  /**
   * Target mobile platform. Normally derived from the capability
   * (`platformName`); set explicitly to override.
   */
  platform?: 'android' | 'ios';
  /**
   * Host of the Metro inspector-proxy used for the Hermes CDP attach
   * (`execute`/`mock`).
   * @default 'localhost'
   */
  metroHost?: string;
  /**
   * Port of the Metro inspector-proxy.
   * @default 8081
   */
  metroPort?: number;
  /**
   * Path to a built app (`.apk` / `.app` / `.ipa`). Convenience that maps onto
   * `appium:app` when the capability doesn't already set a launch target —
   * prefer setting the `appium:*` launch capability directly.
   */
  appBinaryPath?: string;
}

/**
 * React Native service global options (service-level; merged under per-capability options).
 * Identical shape to {@link ReactNativeServiceOptions} — alias so the two types stay in sync.
 */
export type ReactNativeServiceGlobalOptions = ReactNativeServiceOptions;

/**
 * React Native service result type.
 * Uses the standard Result pattern: check `result.ok`, then access `result.value` or `result.error`.
 */
export type ReactNativeResult<T = unknown> = Result<T, string>;

/**
 * React Native capabilities for WebdriverIO configuration.
 *
 * A plain interface (does not extend `WebdriverIO.Capabilities`) holding the
 * Appium capabilities a React Native session needs, plus the service options.
 */
export interface ReactNativeCapabilities {
  platformName: 'Android' | 'iOS';
  'appium:automationName'?: 'UiAutomator2' | 'XCUITest';
  'appium:deviceName'?: string;
  'appium:udid'?: string;
  'appium:platformVersion'?: string;
  /** Path to a `.apk`/`.app`/`.ipa`, mapped to `appium:app`. */
  'appium:app'?: string;
  /** Android: launch by package + activity instead of an app path. */
  'appium:appPackage'?: string;
  'appium:appActivity'?: string;
  /** iOS: launch by bundle id instead of an app path. */
  'appium:bundleId'?: string;
  'wdio:reactNativeServiceOptions'?: ReactNativeServiceOptions;
}

/**
 * React Native service capabilities (requested-capability typing).
 */
export interface ReactNativeServiceCapabilities {
  platformName?: 'Android' | 'iOS';
  'wdio:reactNativeServiceOptions'?: ReactNativeServiceOptions;
}

type ReactNativeServiceRequestedStandaloneCapabilities = Capabilities.RequestedStandaloneCapabilities &
  ReactNativeServiceCapabilities;
type ReactNativeServiceRequestedMultiremoteCapabilities = Capabilities.RequestedMultiremoteCapabilities &
  ReactNativeServiceCapabilities;

export type ReactNativeServiceCapabilitiesType =
  | ReactNativeServiceRequestedStandaloneCapabilities[]
  | ReactNativeServiceRequestedMultiremoteCapabilities
  | ReactNativeServiceRequestedMultiremoteCapabilities[];

export type WdioReactNativeConfig = Options.Testrunner & {
  capabilities: ReactNativeServiceCapabilitiesType;
};

/**
 * Browser extension for the React Native service.
 */
export interface ReactNativeBrowserExtension extends BrowserBase {
  /**
   * Access the WebdriverIO React Native Service API.
   *
   * - {@link ReactNativeServiceAPI.execute `browser.reactNative.execute`} - Execute code in the app's Hermes JS realm
   * - {@link ReactNativeServiceAPI.mock `browser.reactNative.mock`} - Mock a function in the React Native JS realm
   * - {@link ReactNativeServiceAPI.isMockFunction `browser.reactNative.isMockFunction`} - Check whether a target/value is mocked
   * - {@link ReactNativeServiceAPI.clearAllMocks `browser.reactNative.clearAllMocks`} - Clear the React Native mock functions
   * - {@link ReactNativeServiceAPI.resetAllMocks `browser.reactNative.resetAllMocks`} - Reset the React Native mock functions
   * - {@link ReactNativeServiceAPI.restoreAllMocks `browser.reactNative.restoreAllMocks`} - Restore the original implementations
   * - {@link ReactNativeServiceAPI.triggerDeeplink `browser.reactNative.triggerDeeplink`} - Trigger a deeplink for testing `Linking`
   * - {@link ReactNativeServiceAPI.switchWindow `browser.reactNative.switchWindow`} - Switch the active Appium context
   * - {@link ReactNativeServiceAPI.listWindows `browser.reactNative.listWindows`} - List the available Appium contexts
   * - {@link ReactNativeServiceAPI.emitEvent `browser.reactNative.emitEvent`} - Emit an event to RN's DeviceEventEmitter
   */
  reactNative: ReactNativeServiceAPI;
}
