import EventEmitter from 'node:events';
import { createLogger } from '@wdio/native-utils';

import type { ProtocolMapping } from 'devtools-protocol/types/protocol-mapping.js';

import { Connection } from './connection.js';
import {
  CDP_DISCONNECT_EVENT,
  DEFAULT_HOSTNAME,
  DEFAULT_MAX_RETRY_COUNT,
  DEFAULT_PORT,
  DEFAULT_RETRY_INTERVAL,
  ERROR_MESSAGE,
  REQUEST_TIMEOUT,
} from './constants.js';
import { DevTool, type DevToolOptions } from './devTool.js';
import { TargetRegistry } from './targetRegistry.js';
import type { ClassifyTarget, TargetRegistryEntry } from './types.js';

const log = createLogger('cdp-bridge', 'bridge');

type Methods = keyof ProtocolMapping.Commands;
type Events = keyof ProtocolMapping.Events;
type MethodParams<T extends Methods> = ProtocolMapping.Commands[T]['paramsType'];
type MethodReturn<T extends Methods> = ProtocolMapping.Commands[T]['returnType'];
type SendParams<T extends Methods> = MethodParams<T> extends [] ? [] : [MethodParams<T>[number]];

export type MultiTargetCdpBridgeOptions = DevToolOptions & {
  waitInterval?: number;
  connectionRetryCount?: number;
  /** WebSocket `Origin` header / extra headers passed to each per-target Connection. */
  origin?: string;
  headers?: Record<string, string>;
  /**
   * Decides which discovered targets are user-facing `content` windows. Injected by
   * the consuming service (renderer-specific — e.g. CEF keys off the `views://` scheme).
   */
  classifyTarget: ClassifyTarget;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Multi-target CDP client. Discovers every content target from `/json`, labels
 * them via {@link TargetRegistry}, and routes commands to the active target —
 * backing a service's `switchWindow`/`listWindows`. Holds one {@link Connection}
 * per attached target.
 *
 * **Invariant: never issues `Page.navigate`.** Attaching/switching only enables
 * the Runtime domain on the live target; reloading would destroy app state.
 */
export class MultiTargetCdpBridge extends EventEmitter {
  #options: Required<Omit<MultiTargetCdpBridgeOptions, 'origin' | 'headers' | 'classifyTarget'>>;
  #origin: string | undefined;
  #headers: Record<string, string> | undefined;
  #devTool: DevTool;
  #registry: TargetRegistry;
  #connections = new Map<string, Connection>();
  #targets: TargetRegistryEntry[] = [];
  #activeLabel: string | undefined;
  #closed = false;
  // Side-channel registry for CDP method listeners subscribed via on().
  // Listeners live on a specific Connection; when that connection drops and is
  // re-opened via #ensureConnection, this registry lets us replay them onto the
  // new socket so callers continue receiving events without re-subscribing.
  #cdpListeners = new Map<string, Set<(...args: unknown[]) => void>>();

  constructor(options: MultiTargetCdpBridgeOptions) {
    super();
    // Per-field `??` rather than Object.assign: a caller passing an explicit
    // `undefined` (e.g. an unset service option) must fall back to the default, not
    // overwrite it. Object.assign copies undefined values, which left `timeout`
    // undefined (so waitPort never actually waited → immediate-fail hammering) and
    // `connectionRetryCount` undefined (so `retries >= undefined` never capped →
    // effectively unbounded retries).
    this.#options = {
      host: options.host ?? DEFAULT_HOSTNAME,
      port: options.port ?? DEFAULT_PORT,
      timeout: options.timeout ?? REQUEST_TIMEOUT,
      waitInterval: options.waitInterval ?? DEFAULT_RETRY_INTERVAL,
      connectionRetryCount: options.connectionRetryCount ?? DEFAULT_MAX_RETRY_COUNT,
    };
    this.#origin = options.origin;
    this.#headers = options.headers;
    this.#devTool = new DevTool(this.#options);
    this.#registry = new TargetRegistry(options.classifyTarget);
  }

  /** Discover content targets, then attach to the primary (`main`) target. */
  async connect(): Promise<void> {
    // A closed bridge must stay closed: a late connect() (e.g. a retry hook
    // overlapping teardown) would open sockets nobody will ever close again.
    if (this.#closed) {
      throw new Error(ERROR_MESSAGE.BRIDGE_CLOSED);
    }
    await this.#discover();
    // A close() may have landed on discovery's final await; bail before committing
    // #activeLabel so a stale active target can't outlive close() (it would otherwise
    // surface NOT_CONNECTED instead of BRIDGE_CLOSED on the next send()).
    if (this.#closed) {
      throw new Error(ERROR_MESSAGE.BRIDGE_CLOSED);
    }
    if (this.#targets.length === 0) {
      throw new Error(ERROR_MESSAGE.NO_PAGE_TARGETS);
    }
    this.#activeLabel = this.#targets[0].label;
    await this.#ensureConnection(this.#activeLabel);
  }

  /** Re-enumerate targets (e.g. after a new window opens) and prune dead connections. */
  async refresh(): Promise<TargetRegistryEntry[]> {
    // Entry guard mirrors connect(): a closed bridge must not re-enumerate or
    // re-open sockets. Downstream #ensureConnection is already guarded, so this is
    // defensive symmetry rather than a leak fix.
    if (this.#closed) {
      throw new Error(ERROR_MESSAGE.BRIDGE_CLOSED);
    }
    const list = await this.#devTool.list();
    // close() may have landed during the await; don't return a populated list on a
    // torn-down bridge (caller would otherwise see NOT_CONNECTED, not BRIDGE_CLOSED) —
    // mirrors the post-await guard in #discover()/#ensureConnection().
    if (this.#closed) {
      throw new Error(ERROR_MESSAGE.BRIDGE_CLOSED);
    }
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

  /** Live content target labels — backs a service's `listWindows()`. */
  listWindows(): string[] {
    return this.#targets.map((target) => target.label);
  }

  get activeLabel(): string | undefined {
    return this.#activeLabel;
  }

  /** CDP `/json/version` for the instance (browser/Chromium version, for driver matching). */
  version() {
    return this.#devTool.version();
  }

  /** Make `label` the active target — backs a service's `switchWindow()`. */
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
  on(event: typeof CDP_DISCONNECT_EVENT, listener: () => void): this;
  on<T extends Events>(event: T, listener: (param: ProtocolMapping.Events[T][number]) => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this {
    if (event === CDP_DISCONNECT_EVENT) {
      return super.on(event, listener);
    }
    // Store in the side-channel registry so #ensureConnection can replay onto
    // the replacement socket when the active connection drops and is re-opened.
    let set = this.#cdpListeners.get(event);
    if (!set) {
      set = new Set();
      this.#cdpListeners.set(event, set);
    }
    set.add(listener);
    this.#active().on(event as Events, listener as (param: unknown) => void);
    return this;
  }

  /** Unsubscribe from a CDP event or the disconnect lifecycle event. */
  off(event: typeof CDP_DISCONNECT_EVENT, listener: () => void): this;
  off<T extends Events>(event: T, listener: (param: ProtocolMapping.Events[T][number]) => void): this;
  off(event: string, listener: (...args: unknown[]) => void): this {
    if (event === CDP_DISCONNECT_EVENT) {
      return super.off(event, listener);
    }
    // Remove from the registry so #ensureConnection no longer replays this listener.
    const set = this.#cdpListeners.get(event);
    if (set) {
      set.delete(listener);
      if (set.size === 0) {
        this.#cdpListeners.delete(event);
      }
    }
    // No-op when not connected: there is no active connection to remove from.
    if (this.#activeLabel) {
      this.#connections.get(this.#activeLabel)?.off(event, listener);
    }
    return this;
  }

  async close(): Promise<void> {
    this.#closed = true;
    await Promise.all([...this.#connections.values()].map((connection) => connection.close()));
    this.#connections.clear();
    this.#activeLabel = undefined;
  }

  async #discover(): Promise<void> {
    let retries = 0;
    while (true) {
      if (this.#closed) {
        throw new Error(ERROR_MESSAGE.BRIDGE_CLOSED);
      }
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
    // Every lazy-connect path funnels through here — after close() a late
    // switchTarget()/sendTo() must not re-open a socket nobody will close.
    if (this.#closed) {
      throw new Error(ERROR_MESSAGE.BRIDGE_CLOSED);
    }
    const existing = this.#connections.get(label);
    if (existing) {
      return existing;
    }
    const target = this.#targets.find((entry) => entry.label === label);
    if (!target) {
      throw new Error(`${ERROR_MESSAGE.TARGET_NOT_FOUND} ${label}`);
    }
    const connection = new Connection(target.webSocketDebuggerUrl, {
      timeout: this.#options.timeout,
      origin: this.#origin,
      headers: this.#headers,
    });
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
    // A close() may have landed on either await above; the socket isn't tracked yet,
    // so close() skipped it. Don't store it into an already-cleared map — mirrors the
    // post-await guard in CdpBridge.connect().
    if (this.#closed) {
      await connection.close().catch(() => {});
      throw new Error(ERROR_MESSAGE.BRIDGE_CLOSED);
    }
    // A concurrent #ensureConnection(label) may have stored a socket while we awaited
    // connect()/Runtime.enable — both passed the early `existing` check seeing nothing.
    // Discard ours and use the winner so the loser isn't orphaned (mirrors the
    // post-await double-connect guard in CdpBridge.connect()).
    const winner = this.#connections.get(label);
    if (winner) {
      await connection.close().catch(() => {});
      return winner;
    }
    connection.on(CDP_DISCONNECT_EVENT, () => {
      // The WebSocket for this target dropped unexpectedly. Remove it from the map
      // so #ensureConnection re-opens it on the next access, clear #activeLabel if
      // it was the active target, then forward the event so consumers can react.
      this.#connections.delete(label);
      if (this.#activeLabel === label) {
        this.#activeLabel = undefined;
      }
      this.emit(CDP_DISCONNECT_EVENT);
    });
    // Replay any CDP method listeners registered via on() onto this new connection.
    // Listeners survive a reconnect: when the active connection drops and the consumer
    // re-establishes via switchTarget()/connect(), #cdpListeners is replayed here.
    for (const [event, listeners] of this.#cdpListeners) {
      for (const listener of listeners) {
        connection.on(event as Events, listener as (param: unknown) => void);
      }
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
