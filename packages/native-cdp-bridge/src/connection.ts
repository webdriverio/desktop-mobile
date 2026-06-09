import EventEmitter from 'node:events';
import { createLogger } from '@wdio/native-utils';

import type { ProtocolMapping } from 'devtools-protocol/types/protocol-mapping.js';
import WebSocket from 'ws';

import { ERROR_MESSAGE, REQUEST_TIMEOUT } from './constants.js';

const log = createLogger('cdp-bridge', 'bridge');

type Methods = keyof ProtocolMapping.Commands;
type Events = keyof ProtocolMapping.Events;
type MethodParams<T extends Methods> = ProtocolMapping.Commands[T]['paramsType'];
type MethodReturn<T extends Methods> = ProtocolMapping.Commands[T]['returnType'];
type SendParams<T extends Methods> = MethodParams<T> extends [] ? [] : [MethodParams<T>[number]];

type PromiseHandlers = {
  // biome-ignore lint/suspicious/noExplicitAny: holds Promise executors of differing T; `unknown` fails strictFunctionTypes contravariance
  resolve: (value?: any) => void;
  reject: (reason?: unknown) => void;
  timer?: ReturnType<typeof setTimeout>;
};

type EventValue = {
  method: string;
  params: unknown;
  sessionId?: string;
};

type MethodReturnValue = {
  id: number;
  result?: { result: unknown };
  error?: { message: string };
};

export type ConnectionOptions = {
  timeout?: number;
  /**
   * Value for the WebSocket `Origin` header on the upgrade request. Some CDP
   * endpoints enforce an Origin check (e.g. React Native's Fusebox inspector-proxy
   * rejects a missing/foreign Origin with `403/401`). Omit for endpoints that
   * don't care (CEF, Electron).
   */
  origin?: string;
  /** Extra headers for the WebSocket upgrade request (merged after `origin`). */
  headers?: Record<string, string>;
};

// Reserved for the connect() promise: command IDs are pre-incremented from 0,
// so send() emits 1, 2, … and a response can never carry id 0.
const CONNECT_PROMISE_ID = 0;

/**
 * A single CDP WebSocket connection to one target, constructed from an explicit
 * `webSocketDebuggerUrl` (target discovery lives in `DevTool`/the bridge).
 *
 * Deliberately exposes **no navigate helper** — attaching to a live app target
 * must be observation/input only; issuing `Page.navigate` would reload the
 * target and destroy app state. Callers send arbitrary CDP methods via `send()`,
 * but the connection never sends `Page.navigate` on attach.
 */
export class Connection extends EventEmitter {
  readonly webSocketDebuggerUrl: string;
  #timeout: number;
  #origin: string | undefined;
  #headers: Record<string, string> | undefined;
  #ws: WebSocket | null = null;
  #promises = new Map<number, PromiseHandlers>();
  #commandId = CONNECT_PROMISE_ID;
  #closeReason: Error | undefined;

  constructor(webSocketDebuggerUrl: string, options?: ConnectionOptions) {
    super();
    this.webSocketDebuggerUrl = webSocketDebuggerUrl;
    this.#timeout = options?.timeout ?? REQUEST_TIMEOUT;
    this.#origin = options?.origin;
    this.#headers = options?.headers;
  }

  get state() {
    return !this.#ws ? undefined : this.#ws.readyState;
  }

  /** True only while the socket is OPEN — not CONNECTING, CLOSING, or dropped. */
  get isOpen() {
    return this.#ws?.readyState === WebSocket.OPEN;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.#ws) {
        resolve();
        return;
      }
      log.debug(`Connecting: ${this.webSocketDebuggerUrl}`);
      this.#ws = new WebSocket(this.webSocketDebuggerUrl, [], {
        maxPayload: 256 * 1024 * 1024,
        perMessageDeflate: false,
        followRedirects: true,
        handshakeTimeout: this.#timeout,
        origin: this.#origin,
        headers: this.#headers,
      });
      this.#promises.set(CONNECT_PROMISE_ID, { resolve, reject });
      this.#setHandlers(this.#ws);
    });
  }

  on<T extends Events>(event: T, listener: (param: ProtocolMapping.Events[T][number]) => void): this {
    return super.on(event, listener);
  }

  send<T extends Methods>(method: T, ...params: SendParams<T>): Promise<MethodReturn<T>> {
    this.#commandId = this.#commandId + 1;
    const messageId = this.#commandId;
    const message = { id: messageId, method, params: params[0] ?? {} };
    return new Promise((resolve, reject) => {
      if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) {
        reject(new Error(ERROR_MESSAGE.NOT_CONNECTED));
        return;
      }
      const timer = setTimeout(() => {
        if (this.#promises.has(message.id)) {
          this.#promises.delete(message.id);
          reject(new Error(`${ERROR_MESSAGE.TIMEOUT_CONNECTION} ${message.id}`));
        }
      }, this.#timeout);
      this.#promises.set(message.id, { resolve, reject, timer });
      this.#ws.send(JSON.stringify(message));
    });
  }

  close() {
    return this.#close();
  }

  #setHandlers(ws: WebSocket) {
    ws.on('open', () => {
      log.debug(`Connected to ${this.webSocketDebuggerUrl}`);
      this.#promises.get(CONNECT_PROMISE_ID)?.resolve();
      this.#promises.delete(CONNECT_PROMISE_ID);
    });
    ws.on('message', (rawMessage) => {
      try {
        this.#messageHandler(rawMessage.toString());
      } catch (error) {
        log.error('Message handling error');
        void this.#errorHandler(error);
      }
    });
    ws.on('error', (error) => {
      log.error('WebSocket error');
      void this.#errorHandler(error);
    });
    ws.on('close', () => {
      log.trace(ERROR_MESSAGE.CONNECTION_CLOSED);
      this.#rejectAllPromises(this.#closeReason);
      this.#closeReason = undefined;
      this.#ws = null;
    });
  }

  #messageHandler(strMessage: string) {
    const message = parseJson(strMessage);
    if (message.id) {
      this.#responseHandler(message);
    } else if (message.method) {
      this.#eventHandler(message);
    }
  }

  #responseHandler(message: MethodReturnValue) {
    const handler = this.#promises.get(message.id);
    if (!handler) {
      return;
    }
    if (handler.timer) {
      clearTimeout(handler.timer);
    }
    if (message.error) {
      handler.reject(new Error(message.error.message));
    } else {
      handler.resolve(message.result);
    }
    this.#promises.delete(message.id);
  }

  #eventHandler(message: EventValue) {
    const { method, params, sessionId } = message;
    this.emit(method, params, sessionId);
  }

  async #errorHandler(error: unknown) {
    log.error((error as Error).message);
    return await this.#close(error);
  }

  #close(error?: unknown) {
    return new Promise<void>((resolve) => {
      if (this.#ws && this.#ws.readyState !== WebSocket.CLOSED) {
        // Reject pending promises via the single 'close' handler (it fires on
        // ws.close() below), passing the error reason through #closeReason —
        // avoids rejecting them here AND again in the handler. First reason
        // wins: a racing plain close() must not blank an error-path reason.
        this.#closeReason ??= error as Error | undefined;
        this.#ws.once('close', () => {
          this.#ws = null;
          resolve();
        });
        this.#ws.close();
      } else {
        // No open socket → no 'close' event coming; reject directly.
        this.#rejectAllPromises(error as Error | undefined);
        this.#ws = null;
        resolve();
      }
    });
  }

  #rejectAllPromises(error?: Error) {
    const message = error ? `${ERROR_MESSAGE.ERROR_INTERNAL} ${error.message}` : ERROR_MESSAGE.CONNECTION_CLOSED;
    const reason = new Error(message);
    this.#promises.forEach((handler) => {
      if (handler.timer) {
        clearTimeout(handler.timer);
      }
      handler.reject(reason);
    });
    this.#promises.clear();
  }
}

const parseJson = (strJson: string) => {
  try {
    return JSON.parse(strJson);
  } catch (error) {
    throw new Error(`${ERROR_MESSAGE.ERROR_PARSE_JSON} ${(error as Error).message}`);
  }
};
