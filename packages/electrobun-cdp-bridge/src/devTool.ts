import http, { type ClientRequest, type RequestOptions } from 'node:http';
import { createLogger } from '@wdio/native-utils';

import waitPort from 'wait-port';

import { DEFAULT_HOSTNAME, DEFAULT_PORT, ERROR_MESSAGE, REQUEST_TIMEOUT } from './constants.js';
import type { DebuggerList, Version } from './types.js';

const log = createLogger('electrobun-cdp-bridge', 'bridge');

export type DevToolOptions = {
  host?: string;
  port?: number;
  timeout?: number;
};

type DevToolRequestOptions = RequestOptions & {
  path: string;
};

type VersionReturnValue = {
  Browser: string;
  'Protocol-Version': string;
};

type WaitOptions = Parameters<typeof waitPort>[0];

const BRIDGE_RETRY_INTERVAL = 100;

/**
 * Discovers CDP targets from a CEF instance's HTTP debugger endpoint. Mirrors
 * `@wdio/electron-cdp-bridge`'s DevTool, but the consumer keeps **every**
 * `type: 'page'` entry `list()` returns (CEF exposes one per webview), instead
 * of using only the first.
 */
export class DevTool {
  #options: Required<DevToolOptions>;
  #isPortOpened = false;

  constructor(options?: DevToolOptions) {
    // `??` (not Object.assign): an explicit `{ timeout: undefined }` from a caller must
    // fall through to the default, not clobber it — same contract as CdpBridge.
    this.#options = {
      host: options?.host ?? DEFAULT_HOSTNAME,
      port: options?.port ?? DEFAULT_PORT,
      timeout: options?.timeout ?? REQUEST_TIMEOUT,
    };
  }

  list() {
    return this.#executeRequest<DebuggerList>({ path: '/json' });
  }

  async version(): Promise<Version> {
    const result = await this.#executeRequest<VersionReturnValue>({ path: '/json/version' });
    log.info(`Browser: ${result.Browser}, Protocol: ${result['Protocol-Version']}`);
    return {
      browser: result.Browser,
      protocolVersion: result['Protocol-Version'],
    };
  }

  #waitDebuggerPort() {
    return new Promise<void>((resolve, reject) => {
      if (!this.#isPortOpened) {
        const waitOptions: WaitOptions = {
          ...this.#options,
          output: 'silent',
          interval: BRIDGE_RETRY_INTERVAL,
        };
        waitPort(waitOptions)
          .then(() => {
            this.#isPortOpened = true;
            resolve();
          })
          .catch(reject);
      } else {
        resolve();
      }
    });
  }

  async #executeRequest<T>(options: DevToolRequestOptions): Promise<T> {
    const resolvedOptions: RequestOptions = Object.assign({}, this.#options, options);
    log.debug('Request to the debugger', resolvedOptions);
    return new Promise((resolve, reject) => {
      // Order matters: run the request only AFTER the port opens. A `.catch().then()`
      // chain would still run the `.then()` after the port-wait rejected (catch
      // resolves), firing a request at a port that never opened.
      this.#waitDebuggerPort()
        .then(() => {
          const req = http.request(resolvedOptions, (res) => {
            let data = '';
            res.on('data', (chunk) => {
              data += chunk;
            });
            res.on('end', () => {
              try {
                if (res.statusCode === 200) {
                  const message = JSON.parse(data);
                  log.trace('Received response: ', message);
                  resolve(message);
                } else {
                  reject(new Error(data));
                }
              } catch (error) {
                reject(error);
              }
            });
          });

          // req.setTimeout alone covers the socket for the request's lifetime — a
          // socket-level 'timeout' listener would just double-fire #timeoutHandler.
          req.setTimeout(this.#options.timeout, () => {
            this.#timeoutHandler(reject, req);
          });

          req.on('error', (error) => {
            reject(new Error(`Request Error: ${error.message}`));
          });

          req.end();
        })
        .catch(() => {
          reject(new Error(ERROR_MESSAGE.TIMEOUT_WAIT_PORT));
        });
    });
  }

  #timeoutHandler(reject: (reason?: Error) => void, request: ClientRequest) {
    request.destroy();
    const message = `${ERROR_MESSAGE.TIMEOUT_CONNECTION} ${getReqInfo(request)}`;
    log.trace(message);
    reject(new Error(message));
  }
}

const getReqInfo = (request: ClientRequest) =>
  `${request.method} ${request.protocol}//${request.getHeader('Host')}${request.path}`;
