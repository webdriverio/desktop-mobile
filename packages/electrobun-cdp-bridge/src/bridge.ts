import { createLogger } from '@wdio/native-utils';

import type { ProtocolMapping } from 'devtools-protocol/types/protocol-mapping.js';

import { Connection } from './connection.js';
import {
  DEFAULT_HOSTNAME,
  DEFAULT_MAX_RETRY_COUNT,
  DEFAULT_PORT,
  DEFAULT_RETRY_INTERVAL,
  ERROR_MESSAGE,
  REQUEST_TIMEOUT,
} from './constants.js';
import { DevTool, type DevToolOptions } from './devTool.js';
import { TargetRegistry } from './targetRegistry.js';
import type { TargetRegistryEntry } from './types.js';

const log = createLogger('electrobun-cdp-bridge', 'bridge');

type Methods = keyof ProtocolMapping.Commands;
type Events = keyof ProtocolMapping.Events;
type MethodParams<T extends Methods> = ProtocolMapping.Commands[T]['paramsType'];
type MethodReturn<T extends Methods> = ProtocolMapping.Commands[T]['returnType'];
type SendParams<T extends Methods> = MethodParams<T> extends [] ? [] : [MethodParams<T>[number]];

export type CdpBridgeOptions = DevToolOptions & {
  waitInterval?: number;
  connectionRetryCount?: number;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Multi-target CDP client for an Electrobun CEF instance. Discovers every
 * content webview target from `/json`, labels them via {@link TargetRegistry},
 * and routes commands to the active target — backing the service's
 * `switchWindow`/`listWindows`. Unlike a single-target client it holds one
 * {@link Connection} per attached target.
 *
 * **Invariant: never issues `Page.navigate`.** Attaching/switching only enables
 * the Runtime domain on the live target; reloading would destroy app state.
 */
export class CdpBridge {
  #options: Required<CdpBridgeOptions>;
  #devTool: DevTool;
  #registry = new TargetRegistry();
  #connections = new Map<string, Connection>();
  #targets: TargetRegistryEntry[] = [];
  #activeLabel: string | undefined;

  constructor(options?: CdpBridgeOptions) {
    // Per-field `??` rather than Object.assign: a caller passing an explicit
    // `undefined` (e.g. an unset service option) must fall back to the default, not
    // overwrite it. Object.assign copies undefined values, which left `timeout`
    // undefined (so waitPort never actually waited → immediate-fail hammering) and
    // `connectionRetryCount` undefined (so `retries >= undefined` never capped →
    // effectively unbounded retries).
    this.#options = {
      host: options?.host ?? DEFAULT_HOSTNAME,
      port: options?.port ?? DEFAULT_PORT,
      timeout: options?.timeout ?? REQUEST_TIMEOUT,
      waitInterval: options?.waitInterval ?? DEFAULT_RETRY_INTERVAL,
      connectionRetryCount: options?.connectionRetryCount ?? DEFAULT_MAX_RETRY_COUNT,
    };
    this.#devTool = new DevTool(this.#options);
  }

  /** Discover content targets, then attach to the primary (`main`) target. */
  async connect(): Promise<void> {
    await this.#discover();
    if (this.#targets.length === 0) {
      throw new Error(ERROR_MESSAGE.NO_PAGE_TARGETS);
    }
    this.#activeLabel = this.#targets[0].label;
    await this.#ensureConnection(this.#activeLabel);
  }

  /** Re-enumerate targets (e.g. after a new window opens) and prune dead connections. */
  async refresh(): Promise<TargetRegistryEntry[]> {
    const list = await this.#devTool.list();
    this.#targets = this.#registry.reconcile(list);
    const live = new Set(this.#targets.map((target) => target.label));
    // Await the closes so in-flight requests on pruned connections are rejected before
    // refresh() returns — makes teardown deterministic rather than fire-and-forget.
    const closePromises: Promise<void>[] = [];
    for (const [label, connection] of this.#connections) {
      if (!live.has(label)) {
        closePromises.push(connection.close());
        this.#connections.delete(label);
      }
    }
    await Promise.allSettled(closePromises);
    // If the active target was pruned (its window closed), auto-advance to the
    // first surviving target so subsequent send()/on() don't throw an opaque
    // NOT_CONNECTED — callers can still switchTarget() explicitly. The survivor
    // may never have been connected (discovered by an earlier refresh, never
    // switched to), so open its connection too; best-effort — a transient
    // connect failure surfaces on the next send(), not here.
    if (this.#activeLabel && !live.has(this.#activeLabel)) {
      this.#activeLabel = this.#targets[0]?.label;
      if (this.#activeLabel) {
        await this.#ensureConnection(this.#activeLabel).catch((error: Error) => {
          log.warn(`Failed to connect auto-advanced target '${this.#activeLabel}': ${error.message}`);
        });
      }
    }
    return [...this.#targets];
  }

  /** Live content targets (registration/label order). */
  listTargets(): TargetRegistryEntry[] {
    return [...this.#targets];
  }

  /** Live content target labels — backs `browser.electrobun.listWindows()`. */
  listWindows(): string[] {
    return this.#targets.map((target) => target.label);
  }

  get activeLabel(): string | undefined {
    return this.#activeLabel;
  }

  /** CDP `/json/version` for the instance (CEF/Chromium version, for driver matching). */
  version() {
    return this.#devTool.version();
  }

  /** Make `label` the active target — backs `browser.electrobun.switchWindow()`. */
  async switchTarget(label: string): Promise<void> {
    if (!this.#targets.some((target) => target.label === label)) {
      throw new Error(`${ERROR_MESSAGE.TARGET_NOT_FOUND} ${label}`);
    }
    await this.#ensureConnection(label);
    this.#activeLabel = label;
  }

  /** Send a CDP command to the active target. */
  send<T extends Methods>(method: T, ...params: SendParams<T>): Promise<MethodReturn<T>> {
    return this.#active().send(method, ...params);
  }

  /** Send a CDP command to a specific target (e.g. log capture attaching everywhere). */
  async sendTo<T extends Methods>(label: string, method: T, ...params: SendParams<T>): Promise<MethodReturn<T>> {
    const connection = await this.#ensureConnection(label);
    return connection.send(method, ...params);
  }

  /** Subscribe to a CDP event on the active target. */
  on<T extends Events>(event: T, listener: (param: ProtocolMapping.Events[T][number]) => void): this {
    this.#active().on(event, listener);
    return this;
  }

  async close(): Promise<void> {
    await Promise.all([...this.#connections.values()].map((connection) => connection.close()));
    this.#connections.clear();
    this.#activeLabel = undefined;
  }

  async #discover(): Promise<void> {
    let retries = 0;
    while (true) {
      try {
        const list = await this.#devTool.list();
        this.#targets = this.#registry.reconcile(list);
        if (this.#targets.length > 0 || retries >= this.#options.connectionRetryCount) {
          return;
        }
      } catch (error) {
        if (retries >= this.#options.connectionRetryCount) {
          throw error;
        }
        log.warn(`Target discovery attempt ${retries + 1} failed: ${(error as Error).message}`);
      }
      retries++;
      await delay(this.#options.waitInterval);
    }
  }

  async #ensureConnection(label: string): Promise<Connection> {
    const existing = this.#connections.get(label);
    if (existing) {
      return existing;
    }
    const target = this.#targets.find((entry) => entry.label === label);
    if (!target) {
      throw new Error(`${ERROR_MESSAGE.TARGET_NOT_FOUND} ${label}`);
    }
    const connection = new Connection(target.webSocketDebuggerUrl, { timeout: this.#options.timeout });
    await connection.connect();
    try {
      // Attach is observation-only — enable Runtime, never Page.navigate.
      await connection.send('Runtime.enable');
    } catch (error) {
      // Not yet tracked in #connections, so close() would never reach it — shut the
      // live socket here or it leaks past bridge.close().
      await connection.close().catch(() => {});
      throw error;
    }
    this.#connections.set(label, connection);
    return connection;
  }

  #active(): Connection {
    if (!this.#activeLabel) {
      throw new Error(ERROR_MESSAGE.NOT_CONNECTED);
    }
    const connection = this.#connections.get(this.#activeLabel);
    if (!connection) {
      throw new Error(ERROR_MESSAGE.NOT_CONNECTED);
    }
    return connection;
  }
}
