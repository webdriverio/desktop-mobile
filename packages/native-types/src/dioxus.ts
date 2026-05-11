import type { Mock } from '@wdio/native-spy';
import type {
  AbstractFn,
  BaseServiceGlobalOptions,
  BaseServiceOptions,
  BrowserBase,
  DriverProviderConfig,
  LogLevel,
  MockOverride,
  MockResult,
  ServiceMockContext,
} from './shared.js';

// ============================================================================
// Dioxus-Specific Types
// ============================================================================

/**
 * Dioxus driver provider.
 *
 * - `'external'` — wdio-dioxus-driver subprocess (Windows only in v1; Linux
 *   blocked pending an upstream Dioxus PR per spike/FINDINGS.md).
 * - `'embedded'` — wdio-dioxus-embedded-driver in-process WebDriver server
 *   (works on all platforms; recommended default).
 *
 * Per Phase -1 spike findings, the launcher throws `SevereServiceError` on
 * Linux when `'external'` is selected.
 */
export type DioxusDriverProvider = 'external' | 'embedded';

/**
 * Bridge-installed APIs available inside the Dioxus app's webview. Mirrors
 * the surface `wdio-dioxus-bridge`'s guest-js bundle exposes on
 * `window.__WDIO_DIOXUS__`.
 */
export interface DioxusAPIs {
  /** Invoke a Rust command via the bridge's `wdio://` custom protocol. */
  invoke: (command: string, args?: unknown) => Promise<unknown>;
  /** Optional log helpers — present when the bridge's log_bridge.rs is wired. */
  log?: {
    trace?: (msg: string) => Promise<void>;
    debug?: (msg: string) => Promise<void>;
    info?: (msg: string) => Promise<void>;
    warn?: (msg: string) => Promise<void>;
    error?: (msg: string) => Promise<void>;
  };
  [key: string]: unknown;
}

interface DioxusMockContext extends ServiceMockContext {
  results: MockResult[];
}

export interface DioxusMockInstance extends Omit<Mock, MockOverride> {
  mockImplementation(fn: AbstractFn): Promise<DioxusMock>;
  mockImplementationOnce(fn: AbstractFn): Promise<DioxusMock>;
  mockReturnValue(obj: unknown): Promise<DioxusMock>;
  mockReturnValueOnce(obj: unknown): Promise<DioxusMock>;
  mockResolvedValue(obj: unknown): Promise<DioxusMock>;
  mockResolvedValueOnce(obj: unknown): Promise<DioxusMock>;
  mockRejectedValue(obj: unknown): Promise<DioxusMock>;
  mockRejectedValueOnce(obj: unknown): Promise<DioxusMock>;
  mockClear(): Promise<DioxusMock>;
  mockReset(): Promise<DioxusMock>;
  mockRestore(): Promise<DioxusMock>;
  mockReturnThis(): Promise<DioxusMock>;
  mockName(name: string): DioxusMock;
  getMockName(): string;
  getMockImplementation(): AbstractFn;
  update(): Promise<DioxusMock>;
  __isDioxusMock: boolean;
  mock: DioxusMockContext;
}

export interface DioxusMock<TArgs extends unknown[] = unknown[], TReturns = unknown> extends DioxusMockInstance {
  new (...args: TArgs): TReturns;
  (...args: TArgs): TReturns;
}

/**
 * Public `browser.dioxus.*` surface installed by `@wdio/dioxus-service`.
 *
 * Surface in PR3: `execute`, `mock`, the mock-lifecycle helpers, plus
 * multi-window APIs (`switchWindow`, `listWindows`). `triggerDeeplink` and
 * per-call execute options land later in PR3 alongside the bridge's
 * `deeplink` module. `emitEvent` is deferred to v1.1 — Dioxus has no
 * native event bus.
 */
export interface DioxusServiceAPI {
  execute<R, A extends unknown[]>(script: string | ((dx: DioxusAPIs, ...a: A) => R), ...args: A): Promise<R>;

  mock(command: string): Promise<DioxusMock>;
  isMockFunction(commandOrFn: unknown): boolean;
  clearAllMocks(prefix?: string): Promise<void>;
  resetAllMocks(prefix?: string): Promise<void>;
  restoreAllMocks(prefix?: string): Promise<void>;

  /** Switch the WebDriver session to the window labelled `label`. */
  switchWindow(label: string): Promise<void>;
  /** List all live window labels in registration order. */
  listWindows(): Promise<string[]>;
}

export interface DioxusServiceOptions extends BaseServiceOptions, DriverProviderConfig {
  /** Test mode: `'native'` runs against a built Dioxus binary; `'browser'` runs the frontend against a Vite dev server in plain Chrome. */
  mode?: 'native' | 'browser';
  /** When `mode === 'browser'`, the URL of the running dev server. */
  devServerUrl?: string;

  driverProvider?: DioxusDriverProvider;
  /** Base port for the wdio-dioxus-driver process. Defaults to 4444. */
  dioxusDriverPort?: number;
  /** Path override for wdio-dioxus-driver. */
  dioxusDriverPath?: string;
  /** Port for the embedded WebDriver server (when provider is 'embedded'). */
  embeddedPort?: number;
  /** Path to the Dioxus app binary. */
  appBinaryPath?: string;
  /** CLI args forwarded to the Dioxus app. */
  appArgs?: string[];
  /** Environment variables for the driver subprocess. */
  env?: Record<string, string>;
  /** Auto-install wdio-dioxus-driver via cargo if missing (defaults to true). */
  autoInstallDioxusDriver?: boolean;
  /** Auto-download msedgedriver on Windows (defaults to true). */
  autoDownloadEdgeDriver?: boolean;
  /** Default window label for execute/mock calls. */
  windowLabel?: string;
  /** Backend log capture toggle. */
  captureBackendLogs?: boolean;
  /** Frontend log capture toggle. */
  captureFrontendLogs?: boolean;
  /** Minimum backend log level (default 'info'). */
  backendLogLevel?: LogLevel;
  /** Minimum frontend log level (default 'info'). */
  frontendLogLevel?: LogLevel;
  /** Embedded server status-poll timeout in ms (default 2000). */
  statusPollTimeout?: number;
}

export interface DioxusServiceGlobalOptions extends BaseServiceGlobalOptions, DriverProviderConfig {
  mode?: 'native' | 'browser';
  devServerUrl?: string;
  driverProvider?: DioxusDriverProvider;
  dioxusDriverPort?: number;
  dioxusDriverPath?: string;
  embeddedPort?: number;
  autoInstallDioxusDriver?: boolean;
  autoDownloadEdgeDriver?: boolean;
  windowLabel?: string;
  captureBackendLogs?: boolean;
  captureFrontendLogs?: boolean;
}

/**
 * Capability shape for Dioxus apps. Mirrors `'tauri:options'` /
 * `'wdio:tauriServiceOptions'` from `@wdio/tauri-service`.
 *
 * Intersect with `Capabilities.RequestedStandaloneCapabilities` at the
 * service-level when needed (see `@wdio/dioxus-service`'s session helpers).
 */
export interface DioxusCapabilities {
  browserName?: 'dioxus' | 'wry' | string;
  'dioxus:options'?: {
    application: string;
    args?: string[];
    webviewOptions?: { width?: number; height?: number };
  };
  'wdio:dioxusServiceOptions'?: DioxusServiceOptions;
}

export interface DioxusBrowserExtension extends BrowserBase {
  dioxus: DioxusServiceAPI;
}

declare global {
  interface Window {
    __WDIO_DIOXUS__?: {
      invoke?: (cmd: string, args?: unknown) => Promise<unknown>;
      log?: DioxusAPIs['log'];
    };
  }
}
