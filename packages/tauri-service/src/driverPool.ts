// Tauri-flavoured wrapper around @wdio/native-core/driverPool.
//
// Core's `DriverPool` is a pure lifecycle manager — it doesn't know how to
// resolve a driver binary path or where to find a WebKit driver. This
// wrapper does the Tauri-specific resolution (ensureTauriDriver,
// getWebKitWebDriverPath) and supplies the Tauri-flavoured log capture
// callback + startup/error markers, then delegates to core.

import { DriverPool as CoreDriverPool, type DriverInfo } from '@wdio/native-core';
import type { LogLevel } from '@wdio/native-types';
import { isErr } from '@wdio/native-utils';

import { ensureTauriDriver } from './driverManager.js';
import { forwardLog } from './logForwarder.js';
import { parseLogLine } from './logParser.js';
import { getWebKitWebDriverPath } from './pathResolver.js';
import type { TauriServiceOptions } from './types.js';

export type { DriverInfo };

export interface DriverStartConfig {
  mode: 'single' | 'worker' | 'multiremote';
  identifier: string;
  port: number;
  nativePort: number;
  options?: TauriServiceOptions;
  env?: NodeJS.ProcessEnv;
  instanceId?: string;
}

const TAURI_STARTUP_MARKERS = ['tauri-driver started', 'listening on'] as const;
const TAURI_ERROR_MARKERS = ['can not listen'] as const;

export class DriverPool {
  private core = new CoreDriverPool();
  private globalOptions: TauriServiceOptions;
  private nativeDriverPath?: string;
  private nativeDriverPathResolved = false;

  constructor(globalOptions: TauriServiceOptions = {}, nativeDriverPath?: string) {
    this.globalOptions = globalOptions;
    this.nativeDriverPath = nativeDriverPath;
  }

  async startDriver(config: DriverStartConfig): Promise<DriverInfo> {
    const serviceOptions = config.options ?? this.globalOptions;
    const driverResult = await ensureTauriDriver(serviceOptions);

    if (isErr(driverResult)) {
      throw driverResult.error;
    }

    const tauriDriverPath = driverResult.value.path;
    if (!this.nativeDriverPathResolved) {
      this.nativeDriverPath = this.nativeDriverPath || getWebKitWebDriverPath();
      this.nativeDriverPathResolved = true;
    }

    return this.core.startDriver({
      mode: config.mode,
      identifier: config.identifier,
      port: config.port,
      nativePort: config.nativePort,
      driverPath: tauriDriverPath,
      nativeDriverPath: this.nativeDriverPath,
      env: config.env,
      instanceId: config.instanceId,
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

  async stopDriver(identifier: string): Promise<void> {
    return this.core.stopDriver(identifier);
  }

  async stopAll(): Promise<void> {
    return this.core.stopAll();
  }

  getDriver(identifier: string): DriverInfo | undefined {
    return this.core.getDriver(identifier);
  }

  getDriverProcess(identifier: string) {
    return this.core.getDriverProcess(identifier);
  }

  getStatus(): { running: boolean; count: number; identifiers: string[] } {
    return this.core.getStatus();
  }

  getRunningPids(): number[] {
    return this.core.getRunningPids();
  }
}
