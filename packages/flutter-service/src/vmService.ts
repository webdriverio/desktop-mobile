// Dart VM Service client — the Flutter analogue of the React Native service's
// MetroBridge/HermesBridge. A thin JSON-RPC-over-WebSocket client to the app's Dart
// VM Service (the "observatory"), used for `execute` (the generic `evaluate` RPC) and
// `mock` (`callServiceExtension` against the `wdio_flutter` `ext.wdio.*` extensions).
//
// We open OUR OWN connection rather than routing through appium-flutter-driver, so the
// service doesn't depend on the driver's extension wrapper (the driver is still used for
// the native session + find/tap). Mirrors the spike's flutter-vm-evaluate proof.

import { createLogger } from '@wdio/native-utils';
import WebSocket from 'ws';

import { SERVICE_NAME } from './constants.js';

const log = createLogger(SERVICE_NAME, 'bridge');

/** A Dart VM Service `@Instance`/`InstanceRef` (the relevant fields). */
export interface VmInstanceRef {
  type?: string;
  kind?: string;
  valueAsString?: string;
  class?: { name?: string };
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface VmServiceClientOptions {
  /** Per-RPC timeout in ms. */
  rpcTimeoutMs?: number;
}

/**
 * JSON-RPC client over the Dart VM Service WebSocket. One connection serves
 * `evaluate` (execute), `callServiceExtension` (mock / Flutter driver), and isolate
 * discovery.
 */
export class VmServiceClient {
  #ws: WebSocket | undefined;
  #nextId = 0;
  #pending = new Map<string, PendingCall>();
  readonly #url: string;
  readonly #rpcTimeoutMs: number;

  constructor(url: string, options: VmServiceClientOptions = {}) {
    this.#url = url;
    this.#rpcTimeoutMs = options.rpcTimeoutMs ?? 15000;
  }

  /** OPEN-state liveness — a dropped socket leaves a non-OPEN instance the caller must reconnect. */
  get connected(): boolean {
    return this.#ws?.readyState === WebSocket.OPEN;
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.#url);
      const onOpen = () => {
        cleanup();
        this.#ws = ws;
        this.#attach(ws);
        log.debug(`Connected to Dart VM Service at ${this.#url}`);
        resolve();
      };
      const onError = (err: Error) => {
        cleanup();
        ws.close();
        reject(err);
      };
      const cleanup = () => {
        ws.off('open', onOpen);
        ws.off('error', onError);
      };
      ws.on('open', onOpen);
      ws.on('error', onError);
    });
  }

  #attach(ws: WebSocket): void {
    ws.on('message', (data: WebSocket.RawData) => {
      let msg: { id?: string | number; result?: unknown; error?: unknown };
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (msg.id == null) {
        return; // a stream event, not an RPC response
      }
      const pending = this.#pending.get(String(msg.id));
      if (!pending) {
        return;
      }
      this.#pending.delete(String(msg.id));
      clearTimeout(pending.timer);
      if (msg.error) {
        pending.reject(new Error(typeof msg.error === 'string' ? msg.error : JSON.stringify(msg.error)));
      } else {
        pending.resolve(msg.result);
      }
    });
    ws.on('close', () => {
      this.#failAllPending(new Error('Dart VM Service socket closed'));
      if (this.#ws === ws) {
        this.#ws = undefined;
      }
    });
    ws.on('error', (err: Error) => log.debug(`Dart VM Service socket error: ${err.message}`));
  }

  #failAllPending(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }

  /** Issue a JSON-RPC call and await its response. */
  rpc<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.#ws || !this.connected) {
      return Promise.reject(new Error(`Dart VM Service is not connected (cannot call ${method})`));
    }
    const id = String(++this.#nextId);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Dart VM Service RPC timed out: ${method}`));
      }, this.#rpcTimeoutMs);
      this.#pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.#ws?.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  getVM(): Promise<{ isolates: Array<{ id: string }> }> {
    return this.rpc('getVM');
  }

  /** The main (root) isolate id — the target for service-extension calls (`ext.wdio.*`). */
  async getMainIsolateId(): Promise<string> {
    const vm = await this.getVM();
    const id = vm.isolates[0]?.id;
    if (!id) {
      throw new Error('No Dart isolate found on the VM Service');
    }
    return id;
  }

  getIsolate(isolateId: string): Promise<{ rootLib: { id: string } }> {
    return this.rpc('getIsolate', { isolateId });
  }

  /** Evaluate a Dart expression against a target (typically the root library). */
  evaluate(isolateId: string, targetId: string, expression: string): Promise<VmInstanceRef> {
    return this.rpc('evaluate', { isolateId, targetId, expression });
  }

  /** Call a registered service extension (e.g. `ext.wdio.setMock`, `ext.flutter.driver`). */
  callServiceExtension<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
    return this.rpc<T>(method, params);
  }

  /** Resolve the main isolate id + its root library id (the `execute` evaluation target). */
  async resolveRootLibrary(): Promise<{ isolateId: string; rootLibraryId: string }> {
    const vm = await this.getVM();
    const isolateId = vm.isolates[0]?.id;
    if (!isolateId) {
      throw new Error('No Dart isolate found on the VM Service');
    }
    const isolate = await this.getIsolate(isolateId);
    const rootLibraryId = isolate.rootLib?.id;
    if (!rootLibraryId) {
      throw new Error(`Dart isolate ${isolateId} exposes no root library`);
    }
    return { isolateId, rootLibraryId };
  }

  async close(): Promise<void> {
    this.#failAllPending(new Error('Dart VM Service client closed'));
    const ws = this.#ws;
    this.#ws = undefined;
    if (!ws) {
      return;
    }
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      ws.once('close', done);
      ws.close();
      // Don't hang teardown on a half-dead socket.
      setTimeout(done, 1000);
    });
  }
}
