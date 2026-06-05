import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { CdpBridge } from '@wdio/native-cdp-bridge';
import { createLogger } from '@wdio/native-utils';

import { DEFAULT_METRO_HOST, DEFAULT_METRO_PORT, SERVICE_NAME } from './constants.js';
import { createHermesBridge, type HermesBridgeOptions } from './hermesBridge.js';

const log = createLogger(SERVICE_NAME, 'bridge');
const execFileAsync = promisify(execFile);

/** Forwards the device's Metro port to the host so the app↔Metro link (and thus the
 *  Hermes inspector target) exists. Injectable for tests / a custom adb path. */
export type AdbReverse = (port: number) => Promise<void>;

const defaultAdbReverse: AdbReverse = async (port) => {
  await execFileAsync('adb', ['reverse', `tcp:${port}`, `tcp:${port}`]);
};

export interface MetroBridgeOptions extends HermesBridgeOptions {
  /** Target platform; `android` triggers the best-effort `adb reverse` step. */
  platform?: 'android' | 'ios';
  /** Override the adb-reverse runner (tests / custom adb path). */
  adbReverse?: AdbReverse;
}

/**
 * Lifecycle wrapper around the single-target Hermes {@link CdpBridge}.
 *
 * Establishes the Android `adb reverse` link, connects lazily, and can reconnect
 * after the Hermes inspector drops (e.g. when the app is backgrounded — the spike
 * showed backgrounding suspends the inspector and the target disappears). The
 * `execute`/`mock` commands drive the underlying bridge via {@link bridge}.
 */
export class MetroBridge {
  #bridge: CdpBridge | undefined;
  readonly #options: MetroBridgeOptions;
  readonly #port: number;
  readonly #adbReverse: AdbReverse;

  constructor(options: MetroBridgeOptions = {}) {
    this.#options = { host: options.host ?? DEFAULT_METRO_HOST, port: options.port ?? DEFAULT_METRO_PORT, ...options };
    this.#port = this.#options.port ?? DEFAULT_METRO_PORT;
    this.#adbReverse = options.adbReverse ?? defaultAdbReverse;
  }

  get connected(): boolean {
    return this.#bridge !== undefined;
  }

  /** The live Hermes bridge. Throws if {@link connect} hasn't run. */
  get bridge(): CdpBridge {
    if (!this.#bridge) {
      throw new Error('Metro bridge is not connected — call connect() first.');
    }
    return this.#bridge;
  }

  /** Connect to the Hermes inspector (idempotent). Android runs `adb reverse` first. */
  async connect(): Promise<void> {
    if (this.#bridge) {
      return;
    }
    if (this.#options.platform === 'android') {
      try {
        await this.#adbReverse(this.#port);
      } catch (error) {
        log.warn(
          `adb reverse tcp:${this.#port} failed (continuing — Metro may already be reachable): ${(error as Error).message}`,
        );
      }
    }
    const bridge = createHermesBridge(this.#options);
    await bridge.connect();
    this.#bridge = bridge;
  }

  /** Re-establish the connection after an inspector drop (close, then connect). */
  async reconnect(): Promise<void> {
    await this.close();
    await this.connect();
  }

  async close(): Promise<void> {
    await this.#bridge?.close();
    this.#bridge = undefined;
  }
}
