import type { Mock } from '@wdio/native-spy';
import type {
  AbstractFn,
  BaseServiceGlobalOptions,
  BaseServiceOptions,
  BrowserBase,
  LogLevel,
  MockOverride,
  MockResult,
  ServiceMockContext,
} from './shared.js';

// ============================================================================
// Electrobun-Specific Types
// ============================================================================

/**
 * Surface installed inside the Electrobun app's webview and injected as the
 * first argument of `browser.electrobun.execute()` callbacks. Electrobun is a
 * CDP-attach framework, so `execute` runs in a webview JS context via CDP
 * `Runtime.callFunctionOn`; this is the in-page handle exposed on
 * `window.__WDIO_ELECTROBUN__`.
 *
 * The concrete shape (which Electrobun RPC/bridge calls are exposed) is being
 * finalised in the Phase 0 spike — kept intentionally open until then.
 */
export interface ElectrobunAPIs {
  /** Optional log helpers, present when frontend log forwarding is wired. */
  log?: {
    trace?: (msg: string) => void;
    debug?: (msg: string) => void;
    info?: (msg: string) => void;
    warn?: (msg: string) => void;
    error?: (msg: string) => void;
  };
  [key: string]: unknown;
}

interface ElectrobunMockContext extends ServiceMockContext {
  results: MockResult[];
}

export interface ElectrobunMockInstance extends Omit<Mock, MockOverride> {
  mockImplementation(fn: AbstractFn): Promise<ElectrobunMock>;
  mockImplementationOnce(fn: AbstractFn): Promise<ElectrobunMock>;
  mockReturnValue(obj: unknown): Promise<ElectrobunMock>;
  mockReturnValueOnce(obj: unknown): Promise<ElectrobunMock>;
  mockResolvedValue(obj: unknown): Promise<ElectrobunMock>;
  mockResolvedValueOnce(obj: unknown): Promise<ElectrobunMock>;
  mockRejectedValue(obj: unknown): Promise<ElectrobunMock>;
  mockRejectedValueOnce(obj: unknown): Promise<ElectrobunMock>;
  mockClear(): Promise<ElectrobunMock>;
  mockReset(): Promise<ElectrobunMock>;
  mockRestore(): Promise<ElectrobunMock>;
  mockReturnThis(): Promise<ElectrobunMock>;
  mockName(name: string): ElectrobunMock;
  getMockName(): string;
  getMockImplementation(): AbstractFn;
  update(): Promise<ElectrobunMock>;
  __isElectrobunMock: boolean;
  mock: ElectrobunMockContext;
}

export interface ElectrobunMock<TArgs extends unknown[] = unknown[], TReturns = unknown>
  extends ElectrobunMockInstance {
  new (...args: TArgs): TReturns;
  (...args: TArgs): TReturns;
}

/**
 * Public `browser.electrobun.*` surface installed by `@wdio/electrobun-service`.
 *
 * Matches the shared cross-service surface (see the convergence standard in
 * AGENTS.md / the add-native-service skill). `emitEvent` is omitted in v1 —
 * Electrobun's event bus lives in the Bun backend, which is not reachable over
 * CDP; it ships only if the spike confirms it can be routed via the in-webview
 * RPC. `mockAll`/class-mock are Electron-only (no enumerable main-process API).
 */
export interface ElectrobunServiceAPI {
  execute<R, A extends unknown[]>(script: string | ((eb: ElectrobunAPIs, ...a: A) => R), ...args: A): Promise<R>;

  mock(target: string): Promise<ElectrobunMock>;
  isMockFunction(targetOrFn: unknown): boolean;
  clearAllMocks(prefix?: string): Promise<void>;
  resetAllMocks(prefix?: string): Promise<void>;
  restoreAllMocks(prefix?: string): Promise<void>;

  /** Switch the active CDP target (window/webview) to the one labelled `label`. */
  switchWindow(label: string): Promise<void>;
  /** List all live window/webview labels in registration order. */
  listWindows(): Promise<string[]>;
  /**
   * Trigger a deeplink (custom-protocol URL) at the OS level so the Electrobun
   * app's registered `open-url` handler receives it. Use for testing the
   * production protocol-handler code path; rejects http/https/file URLs.
   *
   * macOS-only in v1 — Electrobun registers URL schemes via `Info.plist`; the
   * Windows/Linux deeplink path is not yet supported upstream and rejects with
   * a documented-gap error.
   */
  triggerDeeplink(url: string): Promise<void>;
}

/**
 * Electrobun-specific options merged from the shared base. Electrobun is a
 * CDP-attach framework (like Electron, unlike the Wry-based Tauri/Dioxus), so
 * there is no driver-provider config — the launcher spawns the app binary and
 * the worker attaches over CDP.
 */
export interface ElectrobunServiceOptions extends BaseServiceOptions {
  /** Test mode: `'native'` runs against a built Electrobun binary; `'browser'` runs the frontend against a dev server in plain Chrome. */
  mode?: 'native' | 'browser';
  /** When `mode === 'browser'`, the URL of the running dev server. */
  devServerUrl?: string;
  /**
   * Explicit CEF remote-debugging port escape hatch. By default CEF auto-selects
   * a port in the 9222–9232 range at startup and the launcher discovers it, so
   * this is only needed to pin a specific port.
   */
  remoteDebuggingPort?: number;
  /** Per-instance CDP connection timeout in ms. @default 10000 */
  cdpConnectionTimeout?: number;
  /** Number of CDP connection retries before failing. @default 3 */
  cdpConnectionRetryCount?: number;
  /** Interval between CDP connection retries in ms. @default 100 */
  cdpConnectionRetryInterval?: number;
  /** Default window/target label for execute/mock calls. */
  windowLabel?: string;
}

export interface ElectrobunServiceGlobalOptions extends BaseServiceGlobalOptions {
  mode?: 'native' | 'browser';
  devServerUrl?: string;
  remoteDebuggingPort?: number;
  cdpConnectionTimeout?: number;
  cdpConnectionRetryCount?: number;
  cdpConnectionRetryInterval?: number;
  windowLabel?: string;
  backendLogLevel?: LogLevel;
  frontendLogLevel?: LogLevel;
}

/**
 * Capability shape for Electrobun apps. As a CDP-attach service the launcher
 * drives the app through Chromedriver attached to the CEF debugger port, so the
 * effective capability is `browserName: 'chrome'` + `goog:chromeOptions`; there
 * is no `electrobun:options` capability (CDP frameworks have no in-app plumbing).
 *
 * Declared as a plain interface — do NOT extend
 * `Capabilities.RequestedStandaloneCapabilities` (Rollup's TS plugin can't
 * extend dynamic-member interfaces). Intersect at the service level instead.
 */
export interface ElectrobunCapabilities {
  browserName?: 'chrome' | 'electrobun' | string;
  'goog:chromeOptions'?: Record<string, unknown>;
  'wdio:electrobunServiceOptions'?: ElectrobunServiceOptions;
}

export interface ElectrobunBrowserExtension extends BrowserBase {
  electrobun: ElectrobunServiceAPI;
}

declare global {
  interface Window {
    __WDIO_ELECTROBUN__?: {
      log?: ElectrobunAPIs['log'];
      [key: string]: unknown;
    };
  }
}
