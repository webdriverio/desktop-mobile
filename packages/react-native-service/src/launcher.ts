// Main-process launcher for `@wdio/react-native-service`.
//
// React Native is an Appium-driven service: WDIO creates the Appium session, so
// the launcher does not spawn a driver or the app. The device-pool + capability-
// mutation orchestration lives in @wdio/native-mobile-core's `MobileBaseLauncher`;
// this subclass supplies the one per-framework seam — RN's automation names — via
// `mutateCapability`.

import { type DoctorCheck, flattenCaps, MobileBaseLauncher, SevereServiceError } from '@wdio/native-mobile-core';
import type { Options } from '@wdio/types';

import { adbReverse } from './adb.js';
import { prepareReactNativeCapability } from './capabilities.js';
import { CUSTOM_CAPABILITY_NAME, DEFAULT_METRO_PORT, SERVICE_NAME } from './constants.js';
import { reactNativeDoctorChecks } from './diagnostics.js';
import { MetroProcess } from './metroProcess.js';
import type { ReactNativeCapabilities, ReactNativeServiceGlobalOptions } from './types.js';

export default class ReactNativeLaunchService extends MobileBaseLauncher<
  ReactNativeServiceGlobalOptions,
  ReactNativeCapabilities
> {
  // One shared Metro for the whole run, owned by the launcher (main process). Per-worker
  // Metro would bind-conflict on 8081. The Android device→host `adb reverse` is set up
  // per-worker in onWorkerStart (pre-launch); workers then connect via MetroBridge.
  #metro: MetroProcess | undefined;

  constructor(
    options: ReactNativeServiceGlobalOptions,
    _capabilities: ReactNativeCapabilities,
    _config: Options.Testrunner,
  ) {
    super(options, CUSTOM_CAPABILITY_NAME, SERVICE_NAME);
  }

  protected mutateCapability(
    cap: ReactNativeCapabilities,
    options: ReactNativeServiceGlobalOptions,
  ): 'android' | 'ios' {
    return prepareReactNativeCapability(cap, options);
  }

  protected requiredDrivers(platform: 'android' | 'ios'): string[] {
    return platform === 'android' ? ['uiautomator2'] : ['xcuitest'];
  }

  // RN connects to a single shared Metro on a fixed port (default 8081), not a per-cap
  // allocated realm port — so there's no capability for the base launcher to stamp.
  protected portCapKey(): string | undefined {
    return undefined;
  }

  protected doctorChecks(config: Options.Testrunner, platforms: Set<'android' | 'ios'>): DoctorCheck[] {
    return [
      ...super.doctorChecks(config, platforms),
      ...reactNativeDoctorChecks(this.options.metroPort ?? DEFAULT_METRO_PORT),
    ];
  }

  async onPrepare(
    config: Options.Testrunner,
    capabilities: ReactNativeCapabilities[] | Record<string, { capabilities: ReactNativeCapabilities }>,
  ): Promise<void> {
    // Start Metro before super.onPrepare so the Metro-reachable doctor check sees it up.
    if (this.options.manageMetro) {
      this.#metro = new MetroProcess();
      try {
        // Resolve platform the same way onWorkerStart does — options.platform wins over the
        // capability, so an options-level iOS run pre-warms the iOS bundle, not Android.
        const firstCap = flattenCaps<ReactNativeCapabilities>(capabilities)[0];
        const firstPlatform = (this.options.platform ?? firstCap?.platformName)?.toLowerCase();
        await this.#metro.start({
          projectRoot: this.options.metroProjectRoot,
          port: this.options.metroPort,
          platform: firstPlatform === 'ios' ? 'ios' : 'android',
          prebundle: this.options.prebundle,
        });
      } catch (error) {
        // start() can throw *after* Metro spawned (e.g. readiness timeout) — the child is
        // live but unready, so stop it before aborting or it orphans port 8081.
        await this.#stopMetro();
        throw new SevereServiceError(`Failed to start Metro: ${(error as Error).message}`);
      }
    }
    try {
      await super.onPrepare(config, capabilities);
    } catch (error) {
      // super.onPrepare can throw (e.g. doctor: 'strict' fails a check). WDIO then aborts
      // without calling onComplete, so stop the Metro we started — otherwise it's orphaned
      // holding port 8081 and the next run hits EADDRINUSE.
      await this.#stopMetro();
      throw error;
    }
  }

  async onWorkerStart(
    cid: string,
    capabilities: ReactNativeCapabilities | ReactNativeCapabilities[] | Record<string, unknown> | undefined,
  ): Promise<void> {
    await super.onWorkerStart(cid, capabilities);
    if (!capabilities) {
      return;
    }
    // This launcher hook runs (and is awaited) BEFORE the worker creates the Appium session,
    // i.e. before the app launches — the correct point to set up `adb reverse` so the Android
    // app's first JS-bundle load reaches host Metro. super.onWorkerStart has just stamped the
    // device udid, so target the exact emulator when several are attached.
    const port = this.options.metroPort ?? DEFAULT_METRO_PORT;
    for (const cap of flattenCaps<ReactNativeCapabilities>(capabilities)) {
      const c = cap as unknown as Record<string, unknown>;
      const platform = (this.options.platform ?? (c.platformName as string | undefined))?.toLowerCase();
      if (platform === 'android') {
        await adbReverse(port, c['appium:udid'] as string | undefined);
      }
    }
  }

  async onComplete(): Promise<void> {
    await this.#stopMetro();
  }

  async #stopMetro(): Promise<void> {
    if (this.#metro) {
      await this.#metro.stop();
      this.#metro = undefined;
    }
  }
}
