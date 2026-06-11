import type { Mock } from '@wdio/native-spy';
import type { Capabilities, Options } from '@wdio/types';
import type { AbstractFn, BrowserBase, LogCaptureConfig, MockLifecycleConfig, MockOverride, Result } from './shared.js';

// ============================================================================
// Flutter-Specific Types
// ============================================================================

/**
 * Flutter mock instance interface.
 *
 * Same converged Vitest-like shape as the other services. The *inner* mechanism
 * differs (the app opts in via the `wdio_flutter` Dart contract — `ext.wdio.*`
 * service extensions over the Dart VM Service); the surface is identical.
 */
export interface FlutterMockInstance extends Omit<Mock, MockOverride> {
  mockImplementation(fn: AbstractFn): Promise<FlutterMock>;
  mockImplementationOnce(fn: AbstractFn): Promise<FlutterMock>;
  mockReturnValue(obj: unknown): Promise<FlutterMock>;
  mockReturnValueOnce(obj: unknown): Promise<FlutterMock>;
  mockResolvedValue(obj: unknown): Promise<FlutterMock>;
  mockResolvedValueOnce(obj: unknown): Promise<FlutterMock>;
  mockRejectedValue(obj: unknown): Promise<FlutterMock>;
  mockRejectedValueOnce(obj: unknown): Promise<FlutterMock>;
  mockClear(): Promise<FlutterMock>;
  mockReset(): Promise<FlutterMock>;
  mockRestore(): Promise<FlutterMock>;
  mockReturnThis(): Promise<FlutterMock>;
  mockName(name: string): FlutterMock;
  getMockName(): string;
  getMockImplementation(): AbstractFn | undefined;
  update(): Promise<FlutterMock>;
  __isFlutterMock: true;
  mock: Mock['mock'];
}

/**
 * Flutter mock function type.
 */
export interface FlutterMock<TArgs extends unknown[] = unknown[], TReturns = unknown> extends FlutterMockInstance {
  new (...args: TArgs): TReturns;
  (...args: TArgs): TReturns;
}

/**
 * Flutter Service API interface for the browser object.
 *
 * Mirrors the converged `browser.<framework>.*` surface. Native find/tap runs over
 * the Appium W3C session (appium-flutter-driver, `FLUTTER` context); `execute`/`mock`
 * run in the app's Dart isolate over the Dart VM Service.
 *
 * NOTE — `execute` divergence: Flutter has no JS realm, so `script` is a **Dart
 * expression string** evaluated in the app's root library (not a JS function like the
 * other services).
 */
export interface FlutterServiceAPI {
  /**
   * Evaluate a Dart expression in the app's root isolate via the Dart VM Service.
   *
   * Requires a debug/profile build with the VM Service reachable and
   * `enableFlutterDriverExtension()` called before `runApp()`.
   *
   * @example
   * ```js
   * const isFlutter = await browser.flutter.execute('WidgetsBinding.instance != null');
   * ```
   *
   * (Positional args / a Dart `scope` binding are a planned enhancement; v1 evaluates the
   * expression as written.)
   */
  execute<ReturnValue = unknown>(script: string): Promise<ReturnValue>;

  /**
   * Mock a Dart seam the app exposed through the `wdio_flutter` contract (by target id).
   *
   * @example
   * ```js
   * const mock = await browser.flutter.mock('GreetingService.greet');
   * await mock.mockReturnValue('mocked');
   * ```
   */
  mock: (target: string) => Promise<FlutterMock>;

  /**
   * Check whether a target path is mocked, or a value is a Flutter mock function.
   *
   * Overloaded: the value form is a type guard (narrows to {@link FlutterMockInstance}), while the
   * path-string form stays a plain boolean — the runtime is a single check; the overloads only
   * refine the static type.
   * @returns True if the target path is mocked.
   */
  isMockFunction(target: string): boolean;
  /** @returns True (narrowing to {@link FlutterMockInstance}) if the value is a Flutter mock. */
  isMockFunction(fn: unknown): fn is FlutterMockInstance;

  /** Clear all Flutter mocks (optionally filtered by a target-path prefix). */
  clearAllMocks: (targetPrefix?: string) => Promise<void>;

  /** Reset all Flutter mocks (optionally filtered by a target-path prefix). */
  resetAllMocks: (targetPrefix?: string) => Promise<void>;

  /** Restore all Flutter mocks to their original implementations. */
  restoreAllMocks: (targetPrefix?: string) => Promise<void>;

  /** Trigger a deeplink into the app (Appium `mobile: deepLink`). */
  triggerDeeplink: (url: string) => Promise<void>;

  /** Switch the active Appium context (e.g. `NATIVE_APP` ↔ `FLUTTER` ↔ `WEBVIEW_*`). */
  switchContext: (context: string) => Promise<void>;

  /** List the available Appium contexts. */
  listContexts: () => Promise<string[]>;

  /**
   * Emit an event into the app's `wdio_flutter` event bus (the app opts in by listening to
   * `wdioEvents.stream`). The conditional convergent feature — present because Flutter has an
   * event-bus concept via the contract.
   *
   * @example
   * ```js
   * await browser.flutter.emitEvent('deeplink', { path: '/profile' });
   * ```
   */
  emitEvent: (name: string, payload?: unknown) => Promise<void>;

  /**
   * Find a Flutter widget by its `ValueKey` (the recommended, stable selector). Returns a
   * handle for tap/getText; the find runs in the `FLUTTER` context (auto-switched).
   *
   * @example
   * ```js
   * await browser.flutter.byValueKey('increment').tap();
   * const value = await browser.flutter.byValueKey('counter').getText();
   * ```
   */
  byValueKey: (key: string | number) => FlutterElement;

  /** Find a Flutter widget by its rendered text. See {@link byValueKey}. */
  byText: (text: string) => FlutterElement;
}

/**
 * A handle to a Flutter widget located via {@link FlutterServiceAPI.byValueKey} /
 * {@link FlutterServiceAPI.byText}, driven through appium-flutter-driver.
 */
export interface FlutterElement {
  /** Tap the widget. */
  tap: () => Promise<void>;
  /** Read the widget's text. */
  getText: () => Promise<string>;
}

/**
 * The options for the Flutter Service.
 *
 * Like the React Native service, this does **not** extend `BaseServiceOptions`: a
 * Flutter app is launched by Appium via capabilities, so the desktop binary-launch
 * fields don't apply.
 */
export interface FlutterServiceOptions extends LogCaptureConfig, MockLifecycleConfig {
  /** Target mobile platform. Normally derived from the capability (`platformName`). */
  platform?: 'Android' | 'iOS';
  /**
   * Host of the Dart VM Service used for the `execute`/`mock` attach.
   * @default 'localhost'
   */
  vmServiceHost?: string;
  /**
   * Explicit Dart VM Service port. When unset, the service discovers it from the
   * device log; pinning it (also via `appium:dartVmServicePort`) is the CI-robust path —
   * it skips the (up to 60s) log scrape. Requires the app launched with
   * `--disable-service-auth-codes` so the endpoint carries no per-launch token.
   */
  vmServicePort?: number;
  /** Path to a built app (`.apk` / `.app` / `.ipa`). Maps onto `appium:app`. */
  appBinaryPath?: string;
  /** Device pool for parallel workers / multiremote. */
  devices?: Array<{ udid?: string; avd?: string; iOSUdid?: string }>;
}

/**
 * Flutter service global options (service-level; merged under per-capability options).
 */
export type FlutterServiceGlobalOptions = FlutterServiceOptions;

/**
 * Flutter service result type (standard Result pattern).
 */
export type FlutterResult<T = unknown> = Result<T, string>;

/**
 * Flutter capabilities for WebdriverIO configuration.
 *
 * A plain interface holding the Appium capabilities a Flutter session needs
 * (automationName `Flutter` on both OSes via appium-flutter-driver), plus the
 * service options.
 */
export interface FlutterCapabilities {
  platformName: 'Android' | 'iOS';
  'appium:automationName'?: 'Flutter';
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
  /** Pin the Dart VM Service port (deterministic discovery; iOS-friendly). */
  'appium:dartVmServicePort'?: number;
  'wdio:flutterServiceOptions'?: FlutterServiceOptions;
}

/**
 * Flutter service capabilities (requested-capability typing).
 */
export interface FlutterServiceCapabilities {
  platformName?: 'Android' | 'iOS';
  'wdio:flutterServiceOptions'?: FlutterServiceOptions;
}

type FlutterServiceRequestedStandaloneCapabilities = Capabilities.RequestedStandaloneCapabilities &
  FlutterServiceCapabilities;
type FlutterServiceRequestedMultiremoteCapabilities = Capabilities.RequestedMultiremoteCapabilities &
  FlutterServiceCapabilities;

export type FlutterServiceCapabilitiesType =
  | FlutterServiceRequestedStandaloneCapabilities[]
  | FlutterServiceRequestedMultiremoteCapabilities
  | FlutterServiceRequestedMultiremoteCapabilities[];

export type WdioFlutterConfig = Options.Testrunner & {
  capabilities: FlutterServiceCapabilitiesType;
};

/**
 * Browser extension for the Flutter service.
 */
export interface FlutterBrowserExtension extends BrowserBase {
  /**
   * Access the WebdriverIO Flutter Service API.
   *
   * - {@link FlutterServiceAPI.execute `browser.flutter.execute`} — evaluate a Dart expression
   * - {@link FlutterServiceAPI.mock `browser.flutter.mock`} — mock a Dart seam via the contract
   * - {@link FlutterServiceAPI.byValueKey `browser.flutter.byValueKey`} — find a widget by ValueKey (tap/getText)
   * - {@link FlutterServiceAPI.byText `browser.flutter.byText`} — find a widget by text (tap/getText)
   * - {@link FlutterServiceAPI.emitEvent `browser.flutter.emitEvent`} — emit an event into the app's bus
   * - {@link FlutterServiceAPI.triggerDeeplink `browser.flutter.triggerDeeplink`} — trigger a deeplink
   * - {@link FlutterServiceAPI.switchContext `browser.flutter.switchContext`} — switch the Appium context
   * - {@link FlutterServiceAPI.listContexts `browser.flutter.listContexts`} — list the Appium contexts
   */
  flutter: FlutterServiceAPI;
}
