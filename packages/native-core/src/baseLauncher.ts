// Abstract base class for service launchers (Tauri, Dioxus, Electron, …).
//
// Holds the two pieces of shared launcher state every native desktop service
// needs: a {@link PortManager} for allocating driver ports, and a
// {@link DriverPool} for tracking running driver subprocesses. Subclasses
// supply their own WDIO service hooks (`onPrepare`, `onWorkerStart`,
// `onWorkerEnd`, `onComplete`) and call the protected helpers when stopping
// drivers in bulk.
//
// Intentionally minimal in v1. As `@wdio/dioxus-service` materialises and we
// see which patterns are actually shared (vs incidentally similar), more
// behaviour will migrate here. Today the priority is "give subclasses a
// place to inherit shared state from", not "lock in an interface that's
// over-fitted to one consumer."

import { DriverPool } from './driverPool.js';
import { PortManager } from './portManager.js';

export interface BaseLauncherConfig {
  /** Base port for the main driver process. Defaults to 4444. */
  basePort?: number;
  /** Base port for the native driver process. Defaults to 4445. */
  baseNativePort?: number;
}

/**
 * Common launcher state shared by every native desktop service. Subclasses
 * implement WDIO service hooks (`onPrepare`, `onWorkerStart`, `onWorkerEnd`,
 * `onComplete`) and orchestrate driver lifecycle via the protected fields.
 */
export abstract class BaseLauncher {
  protected portManager: PortManager;
  protected driverPool: DriverPool;

  constructor(config: BaseLauncherConfig = {}) {
    this.portManager = new PortManager(config.basePort ?? 4444, config.baseNativePort ?? 4445);
    this.driverPool = new DriverPool();
  }

  /**
   * Stop every running driver in the pool. Subclasses typically call this
   * from their `onComplete` hook to ensure no subprocess leaks across runs.
   */
  protected async stopAllDrivers(): Promise<void> {
    await this.driverPool.stopAll();
  }
}
