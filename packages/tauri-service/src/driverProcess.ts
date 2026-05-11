// Tauri-flavoured wrapper around @wdio/native-core/DriverProcess.
//
// The canonical implementation moved to @wdio/native-core in PR1 of the
// Dioxus service rollout. This wrapper preserves Tauri's old
// `DriverStartOptions` shape (with `tauriDriverPath` + `options:
// TauriServiceOptions`) so existing consumers — notably
// `test/integration/driverProcess.integration.spec.ts` — keep working.
//
// New code should import `DriverProcess` from `@wdio/native-core` directly
// and pass an `onLogLine` callback instead of a service-options bundle.

import { DriverProcess as CoreDriverProcess, type DriverProcessInfo } from '@wdio/native-core';
import type { LogLevel } from '@wdio/native-types';

import { forwardLog } from './logForwarder.js';
import { parseLogLine } from './logParser.js';
import type { TauriServiceOptions } from './types.js';

export type { DriverProcessInfo };

export interface DriverStartOptions {
  mode: 'single' | 'worker' | 'multiremote';
  identifier: string;
  port: number;
  nativePort: number;
  tauriDriverPath: string;
  nativeDriverPath?: string;
  env?: NodeJS.ProcessEnv;
  options: TauriServiceOptions;
  dataDir?: string;
  instanceId?: string;
}

const TAURI_STARTUP_MARKERS = ['tauri-driver started', 'listening on'] as const;
const TAURI_ERROR_MARKERS = ['can not listen'] as const;

/**
 * Lifecycle manager for a single tauri-driver subprocess. Thin shim around
 * the framework-agnostic {@link CoreDriverProcess} in `@wdio/native-core`.
 */
export class DriverProcess {
  private core = new CoreDriverProcess();

  get proc() {
    return this.core.proc;
  }

  get port() {
    return this.core.port;
  }

  get nativePort() {
    return this.core.nativePort;
  }

  get dataDir() {
    return this.core.dataDir;
  }

  async start(opts: DriverStartOptions): Promise<DriverProcessInfo> {
    const serviceOptions = opts.options;

    return this.core.start({
      mode: opts.mode,
      identifier: opts.identifier,
      port: opts.port,
      nativePort: opts.nativePort,
      driverPath: opts.tauriDriverPath,
      nativeDriverPath: opts.nativeDriverPath,
      env: opts.env,
      dataDir: opts.dataDir,
      instanceId: opts.instanceId,
      driverName: 'tauri-driver',
      startupMarkers: TAURI_STARTUP_MARKERS,
      errorMarkers: TAURI_ERROR_MARKERS,
      onLogLine: (line, inst) => {
        const parsed = parseLogLine(line);
        if (!parsed) return;

        if (serviceOptions.captureBackendLogs && parsed.source !== 'frontend') {
          const minLevel = (serviceOptions.backendLogLevel ?? 'info') as LogLevel;
          forwardLog('backend', parsed.level, parsed.message, minLevel, parsed.prefixedMessage, inst);
        }
        if (serviceOptions.captureFrontendLogs && parsed.source === 'frontend') {
          const minLevel = (serviceOptions.frontendLogLevel ?? 'info') as LogLevel;
          forwardLog('frontend', parsed.level, parsed.message, minLevel, parsed.prefixedMessage, inst);
        }
      },
    });
  }

  async stop(): Promise<void> {
    return this.core.stop('tauri-driver');
  }

  isRunning(): boolean {
    return this.core.isRunning();
  }
}
