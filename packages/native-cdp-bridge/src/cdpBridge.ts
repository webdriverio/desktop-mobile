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
import type { Debugger, DebuggerList } from './types.js';

const log = createLogger('cdp-bridge', 'bridge');

type Methods = keyof ProtocolMapping.Commands;
type Events = keyof ProtocolMapping.Events;
type MethodParams<T extends Methods> = ProtocolMapping.Commands[T]['paramsType'];
type MethodReturn<T extends Methods> = ProtocolMapping.Commands[T]['returnType'];
type SendParams<T extends Methods> = MethodParams<T> extends [] ? [] : [MethodParams<T>[number]];

/** Pick the target to attach to from the `/json` listing. */
export type SelectTarget = (targets: DebuggerList) => Debugger | undefined;

export type CdpBridgeOptions = DevToolOptions & {
  waitInterval?: number;
  connectionRetryCount?: number;
  /** WebSocket `Origin` header (e.g. for React Native's Fusebox CSRF check). */
  origin?: string;
  /** Extra WebSocket upgrade headers. */
  headers?: Record<string, string>;
  /**
   * Pick which discovered target to attach to. Default: the first entry with a
   * `webSocketDebuggerUrl` (the single-target / Electron-compatible behaviour).
   * React Native supplies one that selects the live Hermes target.
   */
  selectTarget?: SelectTarget;
};

const defaultSelectTarget: SelectTarget = (targets) => targets.find((t) => t.webSocketDebuggerUrl) ?? targets[0];

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Single-target CDP client: discover targets (`DevTool`), pick one (`selectTarget`),
 * open a {@link Connection}, and expose `send`/`on`. For runtimes with exactly one
 * drivable target (React Native Hermes) or where the first target is the right one
 * (Electron). Multi-window apps use {@link MultiTargetCdpBridge} instead.
 *
 * **Invariant: never issues `Page.navigate`** — attach is observation/input only.
 */
export class CdpBridge {
  #options: Required<DevToolOptions> & { waitInterval: number; connectionRetryCount: number };
  #origin: string | undefined;
  #headers: Record<string, string> | undefined;
  #selectTarget: SelectTarget;
  #devTool: DevTool;
  #connection: Connection | null = null;
  #closed = false;

  constructor(options?: CdpBridgeOptions) {
    // Per-field `??` (not Object.assign): an explicit `undefined` must fall back to
    // the default, not overwrite it (a stray `undefined` left waitPort never waiting
    // and retries effectively unbounded — see the multi-target bridge note).
    this.#options = {
      host: options?.host ?? DEFAULT_HOSTNAME,
      port: options?.port ?? DEFAULT_PORT,
      timeout: options?.timeout ?? REQUEST_TIMEOUT,
      waitInterval: options?.waitInterval ?? DEFAULT_RETRY_INTERVAL,
      connectionRetryCount: options?.connectionRetryCount ?? DEFAULT_MAX_RETRY_COUNT,
    };
    this.#origin = options?.origin;
    this.#headers = options?.headers;
    this.#selectTarget = options?.selectTarget ?? defaultSelectTarget;
    this.#devTool = new DevTool(this.#options);
  }

  get state() {
    return this.#connection?.state;
  }

  /** True only while the underlying CDP socket is OPEN. A live-connection check that, unlike
   *  `state`, doesn't depend on how a dropped socket is represented (the connection nulls its
   *  socket on close, so `state` reads `undefined` — `isOpen` says what it means directly). */
  get isOpen(): boolean {
    return this.#connection?.isOpen ?? false;
  }

  /** CDP `/json/version` (browser/protocol version, for driver matching). */
  version() {
    return this.#devTool.version();
  }

  /** Discover targets, pick one via `selectTarget`, and connect. Retries discovery. */
  async connect(): Promise<void> {
    // #closed before the #connection early-return: close() sets #closed synchronously
    // but awaits the WebSocket handshake before nulling #connection. A connect() in that
    // window would see #connection non-null and return "success" on a tearing-down bridge —
    // mirrors the #closed-first ordering in MultiTargetCdpBridge.#ensureConnection.
    if (this.#closed) {
      throw new Error(ERROR_MESSAGE.BRIDGE_CLOSED);
    }
    if (this.#connection) {
      return; // already connected — idempotent
    }
    let retries = 0;
    while (true) {
      // A close() can land on any await below. A closed bridge must stay closed
      // rather than keep retrying or commit a freshly opened socket nobody will close.
      if (this.#closed) {
        throw new Error(ERROR_MESSAGE.BRIDGE_CLOSED);
      }
      try {
        const list = await this.#devTool.list();
        const target = this.#selectTarget(list);
        if (target?.webSocketDebuggerUrl) {
          const connection = new Connection(target.webSocketDebuggerUrl, {
            timeout: this.#options.timeout,
            origin: this.#origin,
            headers: this.#headers,
          });
          await connection.connect();
          // close() (or a racing connect()) may have completed during the connect
          // above — don't leak this socket or clobber the winner.
          if (this.#closed) {
            await connection.close().catch(() => {});
            throw new Error(ERROR_MESSAGE.BRIDGE_CLOSED);
          }
          if (this.#connection) {
            await connection.close().catch(() => {});
            return;
          }
          this.#connection = connection;
          return;
        }
        if (retries >= this.#options.connectionRetryCount) {
          throw new Error(ERROR_MESSAGE.DEBUGGER_NOT_FOUND);
        }
      } catch (error) {
        // BRIDGE_CLOSED is terminal — never swallow it back into a retry.
        if (this.#closed || retries >= this.#options.connectionRetryCount) {
          throw error;
        }
        log.warn(`Connection attempt ${retries + 1} failed: ${(error as Error).message}`);
      }
      retries++;
      await delay(this.#options.waitInterval);
    }
  }

  send<T extends Methods>(method: T, ...params: SendParams<T>): Promise<MethodReturn<T>> {
    if (!this.#connection) {
      throw new Error(ERROR_MESSAGE.NOT_CONNECTED);
    }
    return this.#connection.send(method, ...params);
  }

  on<T extends Events>(event: T, listener: (param: ProtocolMapping.Events[T][number]) => void): this {
    if (!this.#connection) {
      throw new Error(ERROR_MESSAGE.NOT_CONNECTED);
    }
    this.#connection.on(event, listener);
    return this;
  }

  off<T extends Events>(event: T, listener: (param: ProtocolMapping.Events[T][number]) => void): this {
    // No-op when not connected: there is no listener registry to remove from, and a
    // closed/never-opened bridge has nothing to detach.
    this.#connection?.off(event, listener);
    return this;
  }

  async close(): Promise<void> {
    this.#closed = true;
    await this.#connection?.close();
    this.#connection = null;
  }
}
