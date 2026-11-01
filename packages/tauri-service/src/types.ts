import type {
  TauriServiceGlobalOptions as BaseTauriServiceGlobalOptions,
  TauriServiceOptions as BaseTauriServiceOptions,
} from '@wdio/native-types';

export type { TauriExecuteOptions, TauriResult } from '@wdio/native-types';

/** WebDriver provider for Tauri testing. */
export type DriverProvider = 'external' | 'crabnebula' | 'embedded';

/**
 * Extended Tauri service options with implementation-specific fields
 * Extends the base TauriServiceOptions from native-types with:
 * - env: Environment variables for the app
 * - autoInstallTauriDriver: Auto-install driver if not found
 * - logDir: Custom log directory for standalone mode
 */
export interface TauriServiceOptions extends BaseTauriServiceOptions {
  /**
   * Environment variables for the app, merged over `process.env`. The service passes them to the
   * driver or process that launches the app. A capability-level value replaces the service-level one.
   */
  env?: Record<string, string>;
  /**
   * Automatically install tauri-driver if not found
   * Requires Rust toolchain (cargo) to be installed
   * @default false
   */
  autoInstallTauriDriver?: boolean;
  /**
   * Log directory for standalone mode
   * Full path where log files should be written
   * If not specified, uses logs/standalone-{appDirName}/ in current working directory
   * @default undefined
   */
  logDir?: string;
  /**
   * Timeout in milliseconds for the /status endpoint poll during embedded server startup
   * In slow CI environments (containerised Windows runners), a healthy-but-busy WebDriver server
   * may miss the default 2000ms deadline, causing false-positive restarts
   * @default 2000
   */
  statusPollTimeout?: number;
}

/**
 * Extended Tauri service global options with implementation-specific fields
 */
export interface TauriServiceGlobalOptions extends BaseTauriServiceGlobalOptions {
  /**
   * Environment variables for the app. See {@link TauriServiceOptions.env}.
   */
  env?: Record<string, string>;
  /**
   * Automatically install tauri-driver if not found
   * @default false
   */
  autoInstallTauriDriver?: boolean;
  /**
   * Automatically download and configure matching msedgedriver on Windows
   * Detects Edge version and ensures WebDriver matches to prevent version mismatch errors
   * Only applies on Windows platform, ignored on Linux/macOS
   * Service-level only, since msedgedriver is machine-wide.
   * @default true
   */
  autoDownloadEdgeDriver?: boolean;
  /**
   * Pin the exact msedgedriver version to download on Windows (e.g. `'149.0.4022.98'`), bypassing
   * runtime detection. A CI escape hatch for the next Evergreen WebView2 drift that breaks
   * automation. Otherwise the runtime version is auto-detected — from a fixed-version runtime folder
   * when `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER` is set, else the machine's Evergreen runtime.
   * `EDGEDRIVER_VERSION` in the environment does the same. Windows-only.
   * Service-level only, since msedgedriver is machine-wide.
   */
  edgeDriverVersion?: string;
  /**
   * Log directory for standalone mode. A capability-level value takes precedence.
   * See {@link TauriServiceOptions.logDir}.
   */
  logDir?: string;
}

/**
 * Extended Tauri capabilities with implementation-specific options
 * Re-exports the base TauriCapabilities but uses the extended TauriServiceOptions
 */
export interface TauriCapabilities
  extends Omit<import('@wdio/native-types').TauriCapabilities, 'wdio:tauriServiceOptions'> {
  'wdio:tauriServiceOptions'?: TauriServiceOptions;
}

/**
 * Tauri driver process information
 */
export interface TauriDriverProcess {
  pid: number;
  port: number;
  status: 'starting' | 'running' | 'stopped' | 'error';
}
