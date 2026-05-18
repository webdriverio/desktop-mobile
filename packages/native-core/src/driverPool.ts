// Driver subprocess pool — track multiple {@link DriverProcess} instances
// by identifier, start them on demand, stop them in bulk.
//
// Extracted from packages/tauri-service/src/driverPool.ts. The original
// version called `ensureTauriDriver()` and `getWebKitWebDriverPath()` inside
// `startDriver`. Those resolutions are inherently service-specific (Tauri
// knows how to `cargo install tauri-driver`; Dioxus has its own driver-
// resolution path), so the responsibility shifts to the caller: resolve the
// driver path + native driver path first, then pass them via
// `DriverStartConfig`. The pool itself stays a thin lifecycle manager.

import { createLogger } from '@wdio/native-utils';

import { DriverProcess } from './driverProcess.js';

const log = createLogger('native-core', 'launcher');

export interface DriverInfo {
  process: DriverProcess;
  port: number;
  nativePort: number;
  mode: 'single' | 'worker' | 'multiremote';
  identifier: string;
  /** Driver name used in teardown log messages (e.g. 'tauri-driver'). */
  driverName?: string;
}

export interface DriverStartConfig {
  mode: 'single' | 'worker' | 'multiremote';
  identifier: string;
  port: number;
  nativePort: number;
  /** Path to the driver binary (caller-resolved). */
  driverPath: string;
  /** Path to the native driver binary (caller-resolved). */
  nativeDriverPath?: string;
  env?: NodeJS.ProcessEnv;
  instanceId?: string;
  /** Driver name used in log messages (e.g. 'tauri-driver'). */
  driverName?: string;
  /** Forward each subprocess log line to the service's parser/forwarder. */
  onLogLine?: (line: string, instanceId: string | undefined) => void;
  /** Substrings indicating driver bring-up success. */
  startupMarkers?: readonly string[];
  /** Substrings indicating driver bring-up failure. */
  errorMarkers?: readonly string[];
}

export class DriverPool {
  private drivers = new Map<string, DriverInfo>();

  async startDriver(config: DriverStartConfig): Promise<DriverInfo> {
    if (config.nativeDriverPath) {
      log.debug(`[${config.identifier}] Using native driver: ${config.nativeDriverPath}`);
    }

    const driverProcess = new DriverProcess();

    await driverProcess.start({
      mode: config.mode,
      identifier: config.identifier,
      port: config.port,
      nativePort: config.nativePort,
      driverPath: config.driverPath,
      nativeDriverPath: config.nativeDriverPath,
      env: config.env,
      instanceId: config.instanceId,
      driverName: config.driverName,
      onLogLine: config.onLogLine,
      startupMarkers: config.startupMarkers,
      errorMarkers: config.errorMarkers,
    });

    const info: DriverInfo = {
      process: driverProcess,
      port: config.port,
      nativePort: config.nativePort,
      mode: config.mode,
      identifier: config.identifier,
      driverName: config.driverName,
    };

    this.drivers.set(config.identifier, info);

    log.info(`[${config.identifier}] Driver ready on port ${config.port} (native port: ${config.nativePort})`);
    return info;
  }

  async stopDriver(identifier: string): Promise<void> {
    const info = this.drivers.get(identifier);
    if (!info) {
      log.debug(`No driver found for ${identifier}`);
      return;
    }

    log.info(`Stopping driver [${identifier}]`);
    await info.process.stop(info.driverName);
    this.drivers.delete(identifier);
    log.debug(`Driver [${identifier}] stopped and cleaned up`);
  }

  async stopAll(): Promise<void> {
    const count = this.drivers.size;
    if (count === 0) {
      return;
    }

    log.info(`Stopping ${count} driver(s)...`);

    const stopPromises: Promise<void>[] = [];
    for (const [identifier, info] of this.drivers.entries()) {
      log.debug(`Stopping driver [${identifier}]...`);
      stopPromises.push(info.process.stop(info.driverName));
    }

    await Promise.all(stopPromises);
    this.drivers.clear();

    log.debug('All drivers stopped');
  }

  getDriver(identifier: string): DriverInfo | undefined {
    return this.drivers.get(identifier);
  }

  getDriverProcess(identifier: string): DriverProcess | undefined {
    return this.drivers.get(identifier)?.process;
  }

  getStatus(): { running: boolean; count: number; identifiers: string[] } {
    const identifiers = Array.from(this.drivers.keys());
    const runningCount = Array.from(this.drivers.values()).filter((info) => info.process.isRunning()).length;

    return {
      running: runningCount > 0,
      count: runningCount,
      identifiers,
    };
  }

  getRunningPids(): number[] {
    const pids: number[] = [];
    for (const info of this.drivers.values()) {
      if (info.process.isRunning() && info.process.proc?.pid) {
        pids.push(info.process.proc.pid);
      }
    }
    return pids;
  }
}
