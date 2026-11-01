export type {
  TauriCapabilities,
  TauriExecuteOptions,
  TauriResult,
  TauriServiceGlobalOptions,
  TauriServiceOptions,
} from '@wdio/native-types';

/** WebDriver provider for Tauri testing. */
export type DriverProvider = 'external' | 'crabnebula' | 'embedded';

/**
 * Tauri driver process information
 */
export interface TauriDriverProcess {
  pid: number;
  port: number;
  status: 'starting' | 'running' | 'stopped' | 'error';
}
