// Shared main-process launcher for Appium-driven mobile services.
//
// Mobile services don't spawn a driver or the app — WDIO + @wdio/appium-service
// create the Appium session, which launches the app from capabilities. So this base
// mutates capabilities, allocates devices from a round-robin pool, and (opt-in) drives
// the chromedriver-style setup automation: ensuring the required Appium drivers are
// installed, allocating a per-worker realm port, and running a preflight doctor.
//
// Per-framework seams the subclasses (React Native, Flutter) implement:
//   - `mutateCapability` — set automationName etc. and return the platform.
//   - `requiredDrivers`   — which Appium drivers this service needs per platform.
//   - `portCapKey`        — the capability key to stamp a per-worker realm port into.
//   - `doctorChecks`      — service-specific preflight checks (optional override).

import { BaseLauncher } from '@wdio/native-core';
import { createLogger } from '@wdio/native-utils';
import type { Options } from '@wdio/types';

import { ensureAppiumDriver } from './appiumDriverManager.js';
import { type DeviceDescriptor, DeviceManager } from './deviceManager.js';
import {
  checkAppiumServiceConfigured,
  type DoctorCheck,
  type DoctorMode,
  failFastForMode,
  runDoctor,
} from './doctor.js';
import { getServiceOptionsFromCapability, mergeServiceOptions } from './serviceConfig.js';

/** The option fields the base launcher reads; service options extend this. */
export interface MobileLauncherOptions {
  platform?: string;
  devices?: DeviceDescriptor[];
  /** Opt-in: auto-install the service's required Appium drivers in `onPrepare`. Default off. */
  autoInstallDriver?: boolean;
  /** Preflight doctor mode: `'off'` | `'warn'` (default) | `'strict'` (abort on error). */
  doctor?: DoctorMode;
}

/** WDIO hands the launcher one of three capability shapes; normalise to a flat list. */
export function flattenCaps<TCap>(capabilities: TCap | TCap[] | Record<string, unknown>): TCap[] {
  if (Array.isArray(capabilities)) {
    return capabilities;
  }
  const values = Object.values(capabilities as Record<string, unknown>);
  // Multiremote: every value is an `{ capabilities: {...} }` wrapper.
  if (
    values.length > 0 &&
    values.every((v) => v !== null && typeof v === 'object' && 'capabilities' in (v as object))
  ) {
    return values.map((v) => (v as { capabilities: TCap }).capabilities);
  }
  // A single bare capabilities object.
  return [capabilities as TCap];
}

export abstract class MobileBaseLauncher<
  TOptions extends MobileLauncherOptions,
  TCap extends { platformName?: string },
> extends BaseLauncher {
  protected deviceManager: DeviceManager;
  protected log: ReturnType<typeof createLogger>;
  // Per-worker realm ports allocated via the PortManager seam, released on worker end.
  #allocatedPorts = new Map<string, number[]>();

  /**
   * @param options - the service global options.
   * @param capKey - the `wdio:<framework>ServiceOptions` capability key.
   * @param logNamespace - the consuming service's logger namespace (e.g. `'flutter-service'`).
   */
  constructor(
    protected options: TOptions,
    protected capKey: string,
    protected logNamespace: string,
  ) {
    // Secondary (realm) ports only — the Appium server port is @wdio/appium-service's (4723).
    // Base at 8200 to stay clear of 4444 (WDIO), 4723 (Appium) and 8081 (Metro).
    super({ basePort: 8200, baseNativePort: 8300 });
    this.deviceManager = new DeviceManager(options.devices ?? []);
    this.log = createLogger(logNamespace, 'launcher');
    this.log.debug(`Mobile launcher initialised (device pool: ${this.deviceManager.size})`);
  }

  /**
   * The one per-framework seam: set `appium:automationName` (and any other launch
   * caps) on `cap`, validate the platform, and return the resolved platform.
   * Implementations typically call `prepareMobileCapability`.
   */
  protected abstract mutateCapability(cap: TCap, options: TOptions): 'android' | 'ios';

  /** The Appium driver short-names this service needs for `platform` (e.g. `['uiautomator2']`). */
  protected abstract requiredDrivers(platform: 'android' | 'ios'): string[];

  /**
   * The capability key a per-worker realm port is stamped into (Flutter
   * `'appium:dartVmServicePort'`), or `undefined` when the service uses no allocated port.
   */
  protected abstract portCapKey(): string | undefined;

  /**
   * Service-specific preflight checks. Override and spread `super.doctorChecks(...)` to keep
   * the shared checks. Runs in the launcher (main process) during `onPrepare`.
   */
  protected doctorChecks(config: Options.Testrunner, _platforms: Set<'android' | 'ios'>): DoctorCheck[] {
    return [checkAppiumServiceConfigured(config.services)];
  }

  async onPrepare(
    config: Options.Testrunner,
    capabilities: TCap[] | Record<string, { capabilities: TCap }>,
  ): Promise<void> {
    const platforms = new Set<'android' | 'ios'>();
    for (const cap of flattenCaps<TCap>(capabilities)) {
      const options = mergeServiceOptions(
        this.options,
        getServiceOptionsFromCapability<TOptions>(cap as Record<string, unknown>, this.capKey),
      );
      const platform = this.mutateCapability(cap, options);
      platforms.add(platform);
      // Read automationName back after mutateCapability sets it — confirms which driver was
      // selected at a glance, especially when a per-capability appium:automationName overrides
      // the framework default.
      const automationName = (cap as { 'appium:automationName'?: string })['appium:automationName'];
      this.log.info(`Prepared ${platform} capability (automationName: ${automationName})`);
    }

    // Driver auto-install — opt-in, idempotent, once per launcher (not per worker).
    if (this.options.autoInstallDriver) {
      const names = new Set<string>();
      for (const platform of platforms) {
        for (const name of this.requiredDrivers(platform)) {
          names.add(name);
        }
      }
      for (const name of names) {
        const result = await ensureAppiumDriver(name, { autoInstallDriver: true });
        if (result.ok) {
          this.log.info(`Appium driver '${name}': ${result.value.method}`);
        } else {
          // Non-fatal: a missing driver surfaces as a clear doctor/Appium error downstream.
          this.log.warn(`Appium driver '${name}' not ensured: ${result.error.message}`);
        }
      }
    }

    // Preflight doctor — fail-fast only under doctor: 'strict'.
    if (this.options.doctor !== 'off') {
      await runDoctor(this.doctorChecks(config, platforms), {
        serviceName: this.logNamespace,
        failFast: failFastForMode(this.options.doctor),
      });
    }
  }

  async onWorkerStart(cid: string, capabilities: TCap | TCap[] | Record<string, unknown> | undefined): Promise<void> {
    if (!capabilities) {
      return;
    }
    // Same flattening as onPrepare: for a multiremote run WDIO passes the
    // `{ instance: { capabilities } }` object, not an array, so a bare Array.isArray
    // check would treat the whole object as one cap and never stamp the device.
    const caps = flattenCaps<TCap>(capabilities);
    if (caps.length === 0) {
      return;
    }

    const device = this.deviceManager.claim(cid);
    const portKey = this.portCapKey();
    const allocated: number[] = [];

    // One device per worker (the pool's contract). A multiremote worker shares that one
    // device across its instances — distinct-device-per-instance multiremote would need
    // the pool to allocate N devices per cid, which it doesn't do yet.
    for (const cap of caps) {
      const c = cap as unknown as Record<string, unknown>;
      const options = mergeServiceOptions(
        this.options,
        getServiceOptionsFromCapability<TOptions>(c, this.capKey),
      );
      const platform = options.platform?.toLowerCase() ?? cap.platformName?.toLowerCase();

      if (device && (platform === 'android' || platform === 'ios')) {
        DeviceManager.applyToCapability(c, device, platform);
        this.log.info(`Worker ${cid}: applied device ${JSON.stringify(device)} for ${platform}`);
      }

      // Per-cap realm port — one distinct free port per instance, only when the user
      // hasn't pinned it. PortManager excludes already-used ports, so multiremote
      // instances never collide.
      if (portKey && c[portKey] === undefined) {
        const port = await this.portManager.allocatePort();
        c[portKey] = port;
        allocated.push(port);
        this.log.info(`Worker ${cid}: allocated ${portKey}=${port}`);
      }
    }

    if (allocated.length > 0) {
      this.#allocatedPorts.set(cid, allocated);
    }
  }

  async onWorkerEnd(cid: string): Promise<void> {
    this.deviceManager.release(cid);
    const ports = this.#allocatedPorts.get(cid);
    if (ports) {
      for (const port of ports) {
        this.portManager.releasePort(port);
      }
      this.#allocatedPorts.delete(cid);
    }
  }
}
